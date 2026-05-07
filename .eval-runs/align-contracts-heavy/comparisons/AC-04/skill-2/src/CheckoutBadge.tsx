type ApiCheckout = {
  status: "paid" | "pending" | "failed";
};

type CheckoutStatus = ApiCheckout["status"];

export function toCheckoutStatus(checkout: ApiCheckout): CheckoutStatus {
  return checkout.status;
}
