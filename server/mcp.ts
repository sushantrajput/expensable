import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  checkExpense,
  createPolicy,
  getActivity,
  getPublished,
  getPolicy,
  getVersions,
  listPolicies,
  logCheck,
  normalizeRule,
  publishPolicy,
  updatePolicy,
  formatMoney,
  type PolicyRow,
} from "./policy.js";

const INSTRUCTIONS = `Expensable hosts a company's expense policy as a live page that employees use.
You (Claude) do the thinking and writing: turn what the finance lead says, or an old policy document, into clear structured rules.
Expensable does the rest: it saves the policy, lets finance edit it, publishes it to a public link, answers employees' "Can I expense this?" questions with a fixed rule engine, and records who has read each version.

How to use it:
- Write one rule per spending category (Meals, Hotels, Flights, Local travel, Software, Client entertainment, Alcohol...). Use allowed=false for things that are never reimbursed.
- limit is the hard cap per unit ("per night", "per day", "per person", "per expense"). Above it, the extra is not reimbursed.
- approval_above means pre-approval is needed above that amount. Always name an approver.
- receipt_above: a receipt is needed above this amount. Use 0 for "always".
- Add short sections for anything that isn't a limit: how to submit claims, deadlines, per-diems, exceptions.
- Policies are created as drafts. Tell the user to review the draft at the edit link, or call publish_policy if they ask you to publish.
- Use get_policy_activity to see what employees are asking and who has read the policy, then suggest changes.`;

const ruleSchema = z.object({
  category: z.string().describe("Spending category, e.g. Meals, Hotels, Flights, Cabs, Software, Alcohol"),
  allowed: z.boolean().optional().describe("false = never reimbursable. Defaults to true."),
  limit: z.number().nullable().optional().describe("Hard cap per unit. Omit or null for no cap."),
  unit: z.string().optional().describe('"per expense" (default), "per night", "per day", "per person", "per month"'),
  approval_above: z.number().nullable().optional().describe("Pre-approval is needed above this amount"),
  approver: z.string().optional().describe("Who approves, e.g. 'Finance lead' or 'Reporting manager'"),
  receipt_above: z.number().nullable().optional().describe("A receipt is needed above this amount. 0 = always."),
  notes: z.string().optional().describe("One-line clarification shown to employees"),
});

const sectionSchema = z.object({
  heading: z.string(),
  body: z.string().describe("Plain text. Line breaks are kept, and lines starting with '- ' are shown as bullets."),
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function errorText(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true };
}

export function buildMcpServer(workspace: { id: string; name: string }, baseUrl: string) {
  const server = new McpServer({ name: "expensable", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  const links = (p: PolicyRow) => ({
    edit_url: `${baseUrl}/app/policies/${p.id}`,
    public_url: `${baseUrl}/p/${p.slug}`,
  });

  const describe = (p: PolicyRow) => ({
    policy_id: p.id,
    title: p.title,
    status: p.version === 0 ? "draft (never published)" : p.draft_dirty ? `published v${p.version}, with unpublished edits` : `published v${p.version}`,
    currency: p.currency,
    contact: p.contact,
    summary: p.summary,
    rules: p.rules.map(({ id, ...r }) => r),
    sections: p.sections.map(({ id, ...s }) => s),
    ...links(p),
  });

  server.registerTool(
    "create_policy",
    {
      title: "Create expense policy",
      description:
        "Create a new expense policy as a draft in Expensable. Pass every rule and section. Returns the edit link for finance and the public link for employees.",
      inputSchema: {
        title: z.string().describe("e.g. 'Acme Travel & Expense Policy'"),
        summary: z.string().optional().describe("2-3 sentences for employees: who it applies to and the spirit of it"),
        currency: z.string().optional().describe("ISO code, e.g. INR, USD, SGD. Default INR."),
        contact: z.string().optional().describe("Who employees should ask, e.g. 'Priya (finance@acme.com)'"),
        rules: z.array(ruleSchema).describe("One rule per spending category"),
        sections: z.array(sectionSchema).optional().describe("Free-text sections: how to claim, deadlines, exceptions"),
        publish: z.boolean().optional().describe("Publish right away. Default false, so finance can review the draft first."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      let p = await createPolicy(workspace.id, args, "claude");
      if (args.publish) p = (await publishPolicy(workspace.id, p.id, "Created and published from Claude", "claude"))!;
      const l = links(p);
      return text(
        `Created "${p.title}" with ${p.rules.length} rules and ${p.sections.length} sections (${
          args.publish ? `published as v${p.version}` : "saved as a draft"
        }).\n\nReview and edit: ${l.edit_url}\nEmployee page${args.publish ? "" : " (goes live after publishing)"}: ${l.public_url}\n\n` +
          JSON.stringify({ policy_id: p.id, ...l }, null, 2)
      );
    }
  );

  server.registerTool(
    "list_policies",
    {
      title: "List policies",
      description: "List all expense policies in this workspace, with status, acknowledgement and question counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const rows = await listPolicies(workspace.id);
      if (!rows.length) return text("No policies yet. Use create_policy to make one.");
      return text(
        JSON.stringify(
          rows.map((r: any) => ({
            policy_id: r.id,
            title: r.title,
            status: r.version === 0 ? "draft" : r.draft_dirty ? `v${r.version} + unpublished edits` : `v${r.version} live`,
            rules: r.rule_count,
            acknowledged_current_version: r.acks_current,
            employee_questions: r.checks_total,
            edit_url: `${baseUrl}/app/policies/${r.id}`,
            public_url: `${baseUrl}/p/${r.slug}`,
          })),
          null,
          2
        )
      );
    }
  );

  server.registerTool(
    "get_policy",
    {
      title: "Get policy",
      description: "Get the current draft of a policy: every rule, section and link. This includes any edits finance made in the app.",
      inputSchema: { policy_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ policy_id }) => {
      const p = await getPolicy(workspace.id, policy_id);
      if (!p) return errorText("Policy not found. Call list_policies to see the policy ids.");
      const versions = await getVersions(p.id);
      return text(JSON.stringify({ ...describe(p), versions }, null, 2));
    }
  );

  server.registerTool(
    "update_policy",
    {
      title: "Update policy",
      description:
        "Update a policy's draft. Leave out any field you don't want to change. Passing 'rules' or 'sections' replaces the whole list, so to change one category use set_rule. Changes stay in the draft until published.",
      inputSchema: {
        policy_id: z.string(),
        title: z.string().optional(),
        summary: z.string().optional(),
        currency: z.string().optional(),
        contact: z.string().optional(),
        rules: z.array(ruleSchema).optional(),
        sections: z.array(sectionSchema).optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ policy_id, ...patch }) => {
      const p = await updatePolicy(workspace.id, policy_id, patch);
      if (!p) return errorText("Policy not found.");
      return text(`Draft updated. Review: ${links(p).edit_url}\nCall publish_policy when it's ready for employees.`);
    }
  );

  server.registerTool(
    "set_rule",
    {
      title: "Add or change one rule",
      description:
        "Add a category, or change one if a category with that name already exists, in the policy draft. Example: raise the meals limit to 2000.",
      inputSchema: { policy_id: z.string(), rule: ruleSchema },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ policy_id, rule }) => {
      const p = await getPolicy(workspace.id, policy_id);
      if (!p) return errorText("Policy not found.");
      const idx = p.rules.findIndex((r) => r.category.toLowerCase() === rule.category.trim().toLowerCase());
      const rules = [...p.rules];
      if (idx >= 0) rules[idx] = normalizeRule({ ...rules[idx], ...rule, id: rules[idx].id, category: rules[idx].category });
      else rules.push(normalizeRule(rule));
      const updated = (await updatePolicy(workspace.id, p.id, { rules }))!;
      return text(`${idx >= 0 ? "Updated" : "Added"} "${rule.category}" in the draft. Review: ${links(updated).edit_url}`);
    }
  );

  server.registerTool(
    "remove_rule",
    {
      title: "Remove a rule",
      description: "Remove a category from the policy draft.",
      inputSchema: { policy_id: z.string(), category: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ policy_id, category }) => {
      const p = await getPolicy(workspace.id, policy_id);
      if (!p) return errorText("Policy not found.");
      const rules = p.rules.filter((r) => r.category.toLowerCase() !== category.trim().toLowerCase());
      if (rules.length === p.rules.length) return errorText(`No category called "${category}".`);
      await updatePolicy(workspace.id, p.id, { rules });
      return text(`Removed "${category}" from the draft.`);
    }
  );

  server.registerTool(
    "publish_policy",
    {
      title: "Publish policy",
      description:
        "Publish the current draft as a new version. Employees see it right away at the public link and are asked to acknowledge the new version.",
      inputSchema: {
        policy_id: z.string(),
        change_note: z.string().optional().describe("Short note shown in version history, e.g. 'Raised hotel cap to 7k'"),
      },
      annotations: { destructiveHint: false },
    },
    async ({ policy_id, change_note }) => {
      const p = await publishPolicy(workspace.id, policy_id, change_note || "", "claude");
      if (!p) return errorText("Policy not found.");
      return text(`Published "${p.title}" v${p.version}. Live for employees at ${links(p).public_url}`);
    }
  );

  server.registerTool(
    "check_expense",
    {
      title: "Check an expense",
      description:
        "Check an expense against the published policy (or the draft if it was never published) using Expensable's fixed rules. This gives the same answer an employee gets on the policy page.",
      inputSchema: {
        policy_id: z.string(),
        category: z.string(),
        amount: z.number().describe("Amount in the policy's currency, per unit (e.g. per night for hotels)"),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ policy_id, category, amount }) => {
      const p = await getPolicy(workspace.id, policy_id);
      if (!p) return errorText("Policy not found.");
      const pub = p.version > 0 ? await getPublished(p.slug) : undefined;
      const result = checkExpense(pub ? pub.snapshot : p, category, amount);
      await logCheck(p.id, p.version, result, amount, "claude");
      return text(
        `${result.title}: ${result.message}${result.receipt_required ? " Keep the receipt." : ""}\n\n` +
          JSON.stringify({ verdict: result.verdict, reimbursable: formatMoney(result.reimbursable_amount, p.currency), category: result.category }, null, 2)
      );
    }
  );

  server.registerTool(
    "get_policy_activity",
    {
      title: "Policy activity",
      description:
        "See how employees use the policy: who acknowledged which version, which categories they ask about, how often the answer is 'over limit' or 'needs approval', and questions the policy doesn't cover. Use it to suggest changes.",
      inputSchema: { policy_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ policy_id }) => {
      const p = await getPolicy(workspace.id, policy_id);
      if (!p) return errorText("Policy not found.");
      const a = await getActivity(p.id);
      const current = a.acknowledgements.filter((x: any) => x.version === p.version);
      return text(
        JSON.stringify(
          {
            policy: p.title,
            live_version: p.version,
            currency: p.currency,
            acknowledged_live_version: current.length,
            acknowledged_by: current.map((x: any) => `${x.name} <${x.email}>`),
            acknowledged_older_versions_only: [
              ...new Set(
                a.acknowledgements
                  .filter((x: any) => x.version !== p.version && !current.some((c: any) => c.email === x.email))
                  .map((x: any) => `${x.name} <${x.email}> (v${x.version})`)
              ),
            ],
            questions_by_category: a.checks_by_category,
            questions_not_covered_by_policy: a.uncovered_questions,
            recent_questions: a.recent_checks.slice(0, 25),
          },
          null,
          2
        )
      );
    }
  );

  return server;
}
