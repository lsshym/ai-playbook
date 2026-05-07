type ApiCheckout = {
  status: "paid" | "pending" | "failed";
};

type CheckoutType = "guest" | "express" | "standard";

export function toCheckoutType(_checkout: ApiCheckout): CheckoutType | undefined {
  // FIXME: Field checkoutType missing in API; status is payment state, not checkout type.
  return undefined;
}
