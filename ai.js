import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-ai.js";
import { app } from "./auth.js";

export async function getSmartMoneyAdvice(financialData) {
  // Firebase AI is initialized only when the user actually asks for an AI decision.
  // This prevents an AI SDK/API problem from stopping the rest of My Money from loading.
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, { model: "gemini-3.6-flash" });

  const prompt = `You are the AI Money Advisor inside a personal finance app called My Money.
Analyze the user's financial data and give a practical, personalized decision window.
Do NOT invent numbers. Use only the supplied data. Do not tell the user to manually set a weekly spend limit.

IMPORTANT:
- Account balances may include money accumulated over many years.
- NEVER treat total account balance, old savings, or accumulated money as weekly spending capacity.
- Weekly Spending is only actual expense transactions from Monday through Sunday of the current local week.
- Exclude transfers between the user's own accounts from spending.
- Consider known income, recent spending, upcoming EMI payments, recurring commitments, goal contributions and goal deadlines.
- Reserve committed money before suggesting discretionary spending.
- If there is not enough reliable income/cash-flow history, say what is missing and give a conservative recommendation.
- Clearly distinguish TOTAL BALANCE from SAFE TO SPEND.
- Use the app's supplied safe-to-spend calculation as authoritative; never substitute total/liquid account balance for it.
- Track every supplied EMI and goal, including EMI next dates and linked goal accounts.
- Never automatically transfer or spend money. Recommendations require user approval.

Use these headings:
1. TODAY'S DECISION
2. SAFE TO SPEND
3. WHAT TO DO NOW
4. WHY
5. WATCH OUT FOR

Financial data:
${JSON.stringify(financialData, null, 2)}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  if (!text) throw new Error("The AI returned no recommendation.");
  return text;
}
