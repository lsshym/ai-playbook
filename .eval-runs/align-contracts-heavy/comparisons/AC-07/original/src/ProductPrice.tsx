type ApiProduct = {
  priceInCents: number;
};

export function ProductPrice({ product }: { product: ApiProduct }) {
  return <span>{"$" + product.priceInCents.toFixed(2)}</span>;
}
