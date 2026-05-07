import "./ProfilePanel.css";

type ApiProfile = {
  display_name: string;
};

export function ProfilePanel({ profile }: { profile: ApiProfile }) {
  const { display_name: displayName } = profile;

  return <section className="profile-panel"><h2>{displayName}</h2></section>;
}
