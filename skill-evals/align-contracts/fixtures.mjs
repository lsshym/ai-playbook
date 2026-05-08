import path from "node:path";

export function buildFixture(testCase) {
  const builders = {
    "AC-S01": buildAcS01Fixture,
    "AC-S02": buildAcS02Fixture,
    "AC-S03": buildAcS03Fixture,
    "AC-S04": buildAcS04Fixture,
    "AC-S05": buildAcS05Fixture,
    "AC-S06": buildAcS06Fixture,
  };
  const build = builders[testCase.id] ?? buildGenericFixture;
  const fixture = build(testCase);
  return {
    files: fixture.files.map((file) => ({
      ...file,
      language: file.language ?? languageForPath(file.path),
    })),
  };
}

function buildAcS01Fixture() {
  return {
    files: [
      {
        path: "src/UserHeader.tsx",
        language: "tsx",
        content: tsx(`type ApiUser = {
  user_name: string;
};

type UserViewModel = {
  userName: string;
};

export function UserHeader({ user }: { user: ApiUser }) {
  const view: UserViewModel = {
    userName: user.userName,
  };

  return <h1>{view.userName}</h1>;
}
`),
      },
    ],
  };
}

function buildAcS02Fixture() {
  return {
    files: [
      {
        path: "src/domain/user.ts",
        language: "ts",
        content: ts(`export type User = {
  userId: string;
  displayName: string;
};
`),
      },
      {
        path: "src/api/users.ts",
        language: "ts",
        content: ts(`import type { User } from "../domain/user";

type ApiUser = {
  user_id: string;
  display_name: string;
};

export function loadUser(apiUser: ApiUser): User {
  return apiUser;
}
`),
      },
    ],
  };
}

function buildAcS03Fixture() {
  return reactFixture("CheckoutBadge.tsx", `type ApiCheckout = {
  status: "paid" | "pending" | "failed";
};

type CheckoutType = "guest" | "express" | "standard";

export function toCheckoutType(checkout: ApiCheckout): CheckoutType {
  return checkout.status;
}
`);
}

function buildAcS04Fixture() {
  return reactFixture("UserCard.tsx", `type ApiUser = {
  name: string;
};

type UserCardProps = {
  name: string;
  avatarUrl: string;
};

function UserCard({ name, avatarUrl }: UserCardProps) {
  return <img src={avatarUrl} alt={name} />;
}

export function UserCardFromApi({ user }: { user: ApiUser }) {
  return <UserCard name={user.name} avatarUrl={user.avatarUrl} />;
}
`);
}

function buildAcS05Fixture() {
  return {
    files: [
      {
        path: "src/apiTypes.ts",
        language: "ts",
        content: ts(`export type ApiOrder = {
  id: string;
  amount: {
    total_minor_units: number;
    currency: string;
  };
};

export type ApiRefund = {
  id: string;
  amount: {
    total_minor_units: number;
    currency: string;
  };
};
`),
      },
      {
        path: "src/components/Money.tsx",
        language: "tsx",
        content: tsx(`import type { ApiOrder } from "../apiTypes";

type MoneyProps = {
  amount: ApiOrder["amount"];
};

export function Money({ amount }: MoneyProps) {
  return <span>{amount.currency} {(amount.total_minor_units / 100).toFixed(2)}</span>;
}
`),
      },
      {
        path: "src/pages/OrderSummary.tsx",
        language: "tsx",
        content: tsx(`import type { ApiOrder } from "../apiTypes";
import { Money } from "../components/Money";

export function OrderSummary({ order }: { order: ApiOrder }) {
  return <Money amount={order.amount} />;
}
`),
      },
      {
        path: "src/pages/RefundSummary.tsx",
        language: "tsx",
        content: tsx(`import type { ApiRefund } from "../apiTypes";
import { Money } from "../components/Money";

export function RefundSummary({ refund }: { refund: ApiRefund }) {
  return <Money amount={refund.amount} />;
}
`),
      },
    ],
  };
}

function buildAcS06Fixture() {
  return reactFixture("ProfilePanel.tsx", `import "./ProfilePanel.css";

type ApiProfile = {
  display_name: string;
};

export function ProfilePanel({ profile }: { profile: ApiProfile }) {
  return <section className="profile-panel"><h2>{profile.displayName}</h2></section>;
}
`);
}

function buildGenericFixture(testCase) {
  return {
    files: [{
      path: "src/example.ts",
      language: "ts",
      content: ts(`export const scenario = ${JSON.stringify(stripMarkdown(testCase.scenario))};
`),
    }],
  };
}

function reactFixture(fileName, content) {
  return {
    files: [{
      path: `src/${fileName}`,
      language: "tsx",
      content: tsx(content),
    }],
  };
}

function languageForPath(filePath) {
  const ext = path.extname(filePath).slice(1);
  return ext === "ts" ? "typescript" : ext || "text";
}

function stripMarkdown(value = "") {
  return value.replace(/`/g, "");
}

function ts(value) {
  return `${value.trim()}\n`;
}

function tsx(value) {
  return ts(value);
}
