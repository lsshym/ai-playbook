type ApiOrder = {
  id: string;
  amount: {
    total_minor_units: number;
  };
};

type MoneyProps = {
  totalCents: number;
};

function Money({ totalCents }: MoneyProps) {
  return <span>{(totalCents / 100).toFixed(2)}</span>;
}

export function OrderSummary({ order }: { order: ApiOrder }) {
  return <Money totalCents={order.totalCents} />;
}
