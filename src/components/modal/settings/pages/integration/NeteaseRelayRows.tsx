import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Row, Status, TextField } from '../../kit';
import { O } from './options';
import {
    getNeteaseApiBaseOverride,
    getNeteaseBuildTimeApiBase,
    setNeteaseApiBaseOverride,
} from '../../../../../services/onlineMusic/netease/neteaseEndpointSetting';
import { probeNeteaseRelay, type NeteaseRelayProbe } from '../../../../../services/onlineMusic/netease/neteaseRelayProbe';

// src/components/modal/settings/pages/integration/NeteaseRelayRows.tsx
// 网易云中转地址这一行：只在原生壳（IPA）出现——装好之后改不了包，也没法再传构建期变量，
// 只能在这里填。填了存 localStorage，优先于打包时注入的地址；「清除」回到打包时那个值。
// 地址只在点保存时生效；保存时会通知 netease.ts 清掉地址缓存（onNeteaseApiBaseChange），不用重启应用。
// 保存前先问一次后端（neteaseRelayProbe）：地址写错、服务没起、网关挡掉，当场就能看出来，
// 不必等到登录窗口里才失败。

const probeText = (t: (key: string, options?: Record<string, unknown>) => string, result: NeteaseRelayProbe): string => {
    if (result.ok) return t('options.neteaseRelayProbeOk', { ms: result.durationMs });
    if (result.reason === 'timeout') return t('options.neteaseRelayProbeTimeout');
    if (result.reason === 'bad-answer') return t('options.neteaseRelayProbeBadAnswer', { detail: result.detail });
    if (result.reason === 'empty') return t('options.neteaseRelayMissing');
    return t('options.neteaseRelayProbeUnreachable', { detail: result.detail });
};

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
        try {
            setProbe(await probeNeteaseRelay(draft));
        } finally {
            setProbing(false);
        }
    };

    const save = async () => {
        // 先问一次：地址不通就不写进去，免得用户以为已经配好了。
        setProbing(true);
        let result: NeteaseRelayProbe;
        try {
            result = await probeNeteaseRelay(draft);
        } finally {
            setProbing(false);
        }
        setProbe(result);
        if (!result.ok) return;
        setNeteaseApiBaseOverride(result.apiBase);
        setDraft(getNeteaseApiBaseOverride());
    };

    const clear = () => {
        setNeteaseApiBaseOverride('');
        setDraft('');
        setProbe(null);
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
                onChange={(value) => {
                    setDraft(value);
                    setProbe(null);
                }}
                placeholder="https://example.com"
            />
            <Button variant="primary" onClick={save} disabled={probing || !changed || !draft.trim()}>
                {probing ? t('options.neteaseRelayProbing') : t('options.neteaseRelaySave')}
            </Button>
            <Button onClick={runProbe} disabled={probing || !draft.trim()}>
                {t('options.neteaseRelayProbe')}
            </Button>
            {hasOwn && <Button onClick={clear}>{t('options.neteaseRelayClear')}</Button>}
            {probe && <Status>{probeText(t, probe)}</Status>}
            {!probe && !hasOwn && !builtIn && <Status>{t('options.neteaseRelayMissingStatus')}</Status>}
            {/* 没填地址时把部署办法写在旁边：这个页面就是要解决「手机上没法直接连网易云」这件事。 */}
            {!hasOwn && !builtIn && (
                <p className="mt-1 max-w-[46ch] text-[11px] leading-[18px] text-[color:var(--st-t3)]">
                    {t('options.neteaseRelaySetupTip')}
                </p>
            )}
        </Row>
    );
};

export default NeteaseRelayRows;
