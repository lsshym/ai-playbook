type ApiProduct = {
  priceInCents: number;
};

export function ProductPrice({ product }: { product: ApiProduct }) {
  return <span>{"$" + (product.priceInCents / 100).toFixed(2)}</span>;
}
