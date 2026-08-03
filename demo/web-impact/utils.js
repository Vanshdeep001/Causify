/* TRIGGER 4 — rename the first function below to anything else.
   TRIGGER 5 — delete the second function below entirely.

   Either way, whoever has app.js open gets an ERROR — and for the
   rename it will tell them the new name. */

export function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function formatMoney(amount) {
  return `£${amount.toFixed(2)}`;
}

export const TAX_RATE = 0.2;
