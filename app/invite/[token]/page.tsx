import InviteClient from './InviteClient';

export default function Page({ params }: { params: { token: string } }) {
  return <InviteClient params={params} />;
} 