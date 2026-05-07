type ApiOrder = {
  id: string;
  amount: {
    total_minor_units: number;
  };
};

type MoneyProps = {
  totalMinorUnits: number;
};

function Money({ totalMinorUnits }: MoneyProps) {
  return <span>{(totalMinorUnits / 100).toFixed(2)}</span>;
}

export function OrderSummary({ order }: { order: ApiOrder }) {
  return <Money totalMinorUnits={order.amount.total_minor_units} />;
}
