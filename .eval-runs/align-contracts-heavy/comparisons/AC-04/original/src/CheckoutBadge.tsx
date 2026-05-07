type ApiCheckout = {
  status: "paid" | "pending" | "failed";
};

type CheckoutType = "guest" | "express" | "standard";

export function toCheckoutType(checkout: ApiCheckout): CheckoutType {
  return checkout.status;
}
