import { one, q } from "./db.js";
import { createAccount } from "./auth.js";
import { createPolicy, publishPolicy } from "./policy.js";

// A demo login so reviewers can try the app without signing up.
export async function seedDemo() {
  const email = (process.env.DEMO_EMAIL || "demo@expensable.app").toLowerCase();
  const password = process.env.DEMO_PASSWORD || "demo1234";
  const existing = await one<{ workspace_id: string }>(`select workspace_id from users where email = $1`, [email]);
  if (existing) {
    if (process.env.DEMO_MCP_KEY)
      await q(`update workspaces set mcp_key = $2 where id = $1`, [existing.workspace_id, process.env.DEMO_MCP_KEY]);
    return;
  }

  await createAccount({ name: "Demo Finance Lead", email, password, company: "Northwind Labs" });
  const u = (await one<{ workspace_id: string }>(`select workspace_id from users where email = $1`, [email]))!;
  if (process.env.DEMO_MCP_KEY) await q(`update workspaces set mcp_key = $2 where id = $1`, [u.workspace_id, process.env.DEMO_MCP_KEY]);

  const p = await createPolicy(
    u.workspace_id,
    {
      title: "Sample: Northwind Travel & Expense Policy",
      summary:
        "This applies to everyone at Northwind Labs. Spend company money the way you'd spend your own: sensibly, and only when it moves the work forward.",
      currency: "INR",
      contact: "Finance (finance@northwind.example)",
      rules: [
        { category: "Meals while travelling", limit: 1500, unit: "per day", receipt_above: 500, notes: "Breakfast is usually included with the hotel." },
        { category: "Hotels", limit: 6000, unit: "per night", approval_above: 4500, approver: "Reporting manager", receipt_above: 0 },
        { category: "Flights", approval_above: 15000, approver: "Finance lead", receipt_above: 0, notes: "Economy only. Book at least 7 days ahead." },
        { category: "Local cabs", limit: 800, unit: "per trip", receipt_above: 300 },
        { category: "Software & subscriptions", approval_above: 0, approver: "Finance lead", receipt_above: 0, notes: "Every new tool needs approval so we avoid duplicate subscriptions." },
        { category: "Alcohol", allowed: false, notes: "Alcohol is never reimbursed, including at client dinners." },
      ],
      sections: [
        {
          heading: "How to claim",
          body: "- Submit claims within 30 days of spending\n- Attach the receipt wherever the policy asks for one\n- Reimbursements are paid with the next payroll",
        },
      ],
    },
    "app"
  );
  await publishPolicy(u.workspace_id, p.id, "First version", "app");
  console.log(`Seeded demo account ${email}`);
}
