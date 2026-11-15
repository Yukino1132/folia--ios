import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row, Status, TextArea } from '../../kit';
import { O } from './options';
import {
    readNeteaseCookie,
    signInWithNeteaseCookie,
    signOutNeteaseCookie,
    type NeteaseCookieSignIn,
} from '../../../../../services/onlineMusic/netease/neteaseCookieSignIn';

// src/components/modal/settings/pages/integration/NeteaseSignInRow.tsx
// 网易云登录凭据这一行：只在原生壳（IPA）出现。扫码确认会被网易云的行为风控拒掉（8821），
// 而登录放在真实浏览器里做就不会——风控要的验证都在浏览器那边过掉了。
// 粘一次凭据，应用把它当作已登录（存在 provider 的会话里，和扫码成功后写的是同一个位置）。
//
// 账号是应用启动时读的，写进凭据之后要重新加载应用才会认到这个人，所以成功之后给一个重新加载的按钮。

export const NeteaseSignInRow: React.FC = () => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<NeteaseCookieSignIn | null>(null);
    // 存着的凭据：读写的是 localStorage，同步，进来时点一次就够。
    const [stored, setStored] = useState<string | null>(() => readNeteaseCookie());

    const signIn = async () => {
        setBusy(true);
        setResult(null);
        try {
            const answer = await signInWithNeteaseCookie(draft);
            setResult(answer);
            if (answer.ok) {
                setDraft('');
                setStored(readNeteaseCookie());
            }
        } finally {
            setBusy(false);
        }
    };

    const signOut = () => {
        signOutNeteaseCookie();
        setStored(null);
        setResult(null);
    };

    const text = (answer: NeteaseCookieSignIn): string => {
        if (answer.ok) return t('options.neteaseSignInOk', { name: answer.nickname || '?' });
        switch (answer.reason) {
            case 'empty':
                return t('options.neteaseSignInEmpty');
            case 'not-a-cookie':
                return t('options.neteaseSignInNotACookie');
            case 'no-relay':
                return t('options.neteaseSignInNoRelay');
            case 'rejected':
                return t('options.neteaseSignInRejected', { detail: answer.detail ?? '' });
            default:
                return t('options.neteaseSignInUnreachable', { detail: answer.detail ?? '' });
        }
    };

    return (
        <Row
            option={O.neteaseSignIn}
            hint={t('options.neteaseSignInHint')}
            note={t('options.neteaseSignInSteps')}
            below={(
                <TextArea
                    value={draft}
                    onChange={setDraft}
                    placeholder="MUSIC_U=…; __csrf=…"
                    disabled={busy}
                />
            )}
        >
            <Button variant="primary" onClick={() => void signIn()} disabled={!draft.trim() || busy}>
                {busy ? t('options.neteaseSignInWorking') : t('options.neteaseSignInSave')}
            </Button>
            {stored && <Button onClick={signOut}>{t('options.neteaseSignInClear')}</Button>}
            {result && <Status tone={result.ok ? 'ok' : 'error'}>{text(result)}</Status>}
            {result?.ok && (
                <Button onClick={() => window.location.reload()}>{t('options.neteaseSignInReload')}</Button>
            )}
        </Row>
    );
};

export default NeteaseSignInRow;
