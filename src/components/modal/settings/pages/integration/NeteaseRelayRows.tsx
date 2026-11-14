import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row, Status, TextField } from '../../kit';
import { O } from './options';
import {
    getNeteaseApiBaseOverride,
    getNeteaseBuildTimeApiBase,
    setNeteaseApiBaseOverride,
} from '../../../../../services/onlineMusic/netease/neteaseEndpointSetting';

// src/components/modal/settings/pages/integration/NeteaseRelayRows.tsx
// 网易云中转地址这一行：只在原生壳（IPA）出现——装好之后改不了包，也没法再传构建期变量，
// 只能在这里填。填了存 localStorage，优先于打包时注入的地址；「清除」回到打包时那个值。
// 地址只在点保存时生效；保存时会通知 netease.ts 清掉地址缓存（onNeteaseApiBaseChange），不用重启应用。

export const NeteaseRelayRows: React.FC = () => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() => getNeteaseApiBaseOverride());
    const saved = getNeteaseApiBaseOverride();
    const builtIn = getNeteaseBuildTimeApiBase();
    const hasOwn = Boolean(saved);
    const changed = draft.trim() !== saved;

    const save = () => {
        setNeteaseApiBaseOverride(draft);
        setDraft(getNeteaseApiBaseOverride());
    };

    const clear = () => {
        setNeteaseApiBaseOverride('');
        setDraft('');
    };

    return (
        <Row
            option={O.neteaseRelay}
            hint={t('options.neteaseRelayDesc')}
            note={hasOwn
                ? t('options.neteaseRelayInUseOwn')
                : builtIn
                    ? t('options.neteaseRelayInUseBuiltIn')
                    : t('options.neteaseRelayMissing')}
        >
            <TextField
                type="url"
                value={draft}
                onChange={setDraft}
                placeholder="https://example.com"
            />
            <Button variant="primary" onClick={save} disabled={!changed || !draft.trim()}>
                {t('options.neteaseRelaySave')}
            </Button>
            {hasOwn && <Button onClick={clear}>{t('options.neteaseRelayClear')}</Button>}
            {!hasOwn && !builtIn && <Status>{t('options.neteaseRelayMissingStatus')}</Status>}
        </Row>
    );
};

export default NeteaseRelayRows;
