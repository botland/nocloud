import { getTranslations } from 'next-intl/server';

export default async function SuccessPage({ searchParams }: { searchParams: { session_id?: string } }) {
  const t = await getTranslations('Success');
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold mb-4">{t('title')}</h1>
        <p className="text-zinc-400">{t('description')}</p>
        <p className="mt-8 text-sm text-zinc-500">Order confirmed. You will receive a confirmation email shortly.</p>
      </div>
    </div>
  );
}