type ApiUser = {
  name: string;
};

type UserCardProps = {
  name: string;
  avatarUrl: string;
};

const DEFAULT_AVATAR_URL = "/default-avatar.png";

function UserCard({ name, avatarUrl }: UserCardProps) {
  return <img src={avatarUrl} alt={name} />;
}

export function UserCardFromApi({ user }: { user: ApiUser }) {
  return <UserCard name={user.name} avatarUrl={DEFAULT_AVATAR_URL} />;
}
