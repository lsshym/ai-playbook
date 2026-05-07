type ApiUser = {
  name: string;
};

type UserCardProps = {
  name: string;
  avatarUrl?: string;
};

function UserCard({ name, avatarUrl }: UserCardProps) {
  if (!avatarUrl) {
    return <span aria-label={`${name} has no avatar`}>{name}</span>;
  }

  return <img src={avatarUrl} alt={name} />;
}

export function UserCardFromApi({ user }: { user: ApiUser }) {
  return <UserCard name={user.name} />;
}
