import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row, Status, TextField } from '../../kit';
import { O } from './options';
import {
    getNeteaseApiBaseOverride,
    getNeteaseBuildTimeApiBase,
    setNeteaseApiBaseOverride,
} from '../../../../../services/onlineMusic/netease/neteaseEndpointSetting';
import {
    probeNeteaseRelay,
    type NeteaseRelayProbe,
} from '../../../../../services/onlineMusic/netease/neteaseRelayProbe';

// src/components/modal/settings/pages/integration/NeteaseRelayRows.tsx
// 网易云中转地址这一行：只在原生壳（IPA）出现——装好之后改不了包，也没法再传构建期变量，
// 只能在这里填。填了存 localStorage，优先于打包时注入的地址；「清除」回到打包时那个值。
// 地址只在点保存时生效；保存时会通知 netease.ts 清掉地址缓存（onNeteaseApiBaseChange），不用重启应用。
// 保存前先探一次连通性：地址写错了（漏协议、端口不对、手机没网）当场就能看出来，
// 不用等到打开网易云页面才发现"连不上"，也避免把一个坏地址存进去。

export const NeteaseRelayRows: React.FC = () => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() => getNeteaseApiBaseOverride());
    const [probing, setProbing] = useState(false);
    const [probe, setProbe] = useState<NeteaseRelayProbe | null>(null);
    const saved = getNeteaseApiBaseOverride();
    const builtIn = getNeteaseBuildTimeApiBase();
    const hasOwn = Boolean(saved);
    const changed = draft.trim() !== saved;

    const runProbe = async () => {
        setProbing(true);
        setProbe(null);
        try {
            const result = await probeNeteaseRelay(draft);
            setProbe(result);
            return result;
        } finally {
            setProbing(false);
        }
    };

    // 保存顺带探连通性：探不通就不存，免得把一个连不上的地址留在设置里。
    const save = async () => {
        const result = await runProbe();
        if (!result.ok) return;
        setNeteaseApiBaseOverride(result.apiBase);
        setDraft(getNeteaseApiBaseOverride());
    };

    const clear = () => {
        setNeteaseApiBaseOverride('');
        setDraft('');
        setProbe(null);
    };

    const probeText = (result: NeteaseRelayProbe): string => {
        if (result.ok) return t('options.neteaseRelayProbeOk', { ms: result.durationMs });
        switch (result.reason) {
            case 'empty':
                return t('options.neteaseRelayProbeUnreachable', { detail: 'empty' });
            case 'timeout':
                return t('options.neteaseRelayProbeTimeout');
            case 'bad-answer':
                return t('options.neteaseRelayProbeBadAnswer', { detail: result.detail });
            default:
                return t('options.neteaseRelayProbeUnreachable', { detail: result.detail });
        }
    };

    // 实际生效的地址跟着输入框走：保存后 draft 就是规整过的值，能直接看出补了什么协议。
    const effective = probing ? '' : (probe?.ok ? probe.apiBase : saved);

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
                placeholder="http://192.168.1.10:3457"
            />
            <Button variant="primary" onClick={save} disabled={!changed || !draft.trim() || probing}>
                {probing ? t('options.neteaseRelayProbing') : t('options.neteaseRelaySave')}
            </Button>
            <Button onClick={runProbe} disabled={!draft.trim() || probing}>
                {t('options.neteaseRelayProbe')}
            </Button>
            {hasOwn && <Button onClick={clear}>{t('options.neteaseRelayClear')}</Button>}
            {probe && <Status>{probeText(probe)}</Status>}
            {!probe && effective && <Status>{effective}</Status>}
            {!hasOwn && !builtIn && <Status>{t('options.neteaseRelayMissingStatus')}</Status>}
            {!draft.trim() && <p>{t('options.neteaseRelaySetupTip')}</p>}
        </Row>
    );
};

export default NeteaseRelayRows;
