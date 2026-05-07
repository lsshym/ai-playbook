type ApiCheckout = {
  status: "paid" | "pending" | "failed";
  checkoutType: CheckoutType;
};

type CheckoutType = "guest" | "express" | "standard";

export function toCheckoutType(checkout: ApiCheckout): CheckoutType {
  return checkout.checkoutType;
}
