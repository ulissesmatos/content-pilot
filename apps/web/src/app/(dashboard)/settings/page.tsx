import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Configurações' };

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">{t('languageTitle')}</CardTitle>
          <CardDescription>{t('languageDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleSwitcher />
        </CardContent>
      </Card>
    </>
  );
}
