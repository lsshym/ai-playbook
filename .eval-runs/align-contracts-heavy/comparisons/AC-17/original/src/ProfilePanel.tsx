import "./ProfilePanel.css";

type ApiProfile = {
  display_name: string;
};

export function ProfilePanel({ profile }: { profile: ApiProfile }) {
  return <section className="profile-panel"><h2>{profile.displayName}</h2></section>;
}
