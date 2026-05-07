type ApiUser = {
  name: string;
};

type UserCardProps = {
  name: string;
  avatarUrl?: string;
};

function UserCard({ name, avatarUrl }: UserCardProps) {
  if (!avatarUrl) {
    return <span>{name}</span>;
  }

  return <img src={avatarUrl} alt={name} />;
}

export function UserCardFromApi({ user }: { user: ApiUser }) {
  return <UserCard name={user.name} />;
}
