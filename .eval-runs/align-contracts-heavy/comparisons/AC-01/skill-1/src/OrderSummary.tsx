type ApiOrder = {
  id: string;
  amount: {
    total_minor_units: number;
  };
};

type MoneyProps = {
  amount: ApiOrder["amount"];
};

function Money({ amount }: MoneyProps) {
  return <span>{(amount.total_minor_units / 100).toFixed(2)}</span>;
}

export function OrderSummary({ order }: { order: ApiOrder }) {
  return <Money amount={order.amount} />;
}
