import { useEffect, useState } from 'preact/hooks';
import { getMistBuildSnapshot, subscribeMistBuild } from '../lib/mistBuildInfo';
import '../styles/mistBuildBanner.css';

export function MistBuildBanner() {
  const [build, setBuild] = useState(getMistBuildSnapshot);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    const update = () => setBuild(getMistBuildSnapshot());
    const unsubscribe = subscribeMistBuild(update);
    update();
    return unsubscribe;
  }, []);
  const development = import.meta.env.DEV || build.source === 'local' || build.info?.dirty;
  const stateLabel = {
    waiting: '初期化待ち', reported: '実行情報取得済み・整合性は未検証',
    unverified: 'VERSION UNVERIFIED', 'load-error': 'MISTLIB LOAD ERROR',
  }[build.state];
  const diagnostic = JSON.stringify({
    app: 'tc-chat', environment: import.meta.env.MODE,
    ...build, artifactVerification: 'not-implemented', wrapperRevision: 'unknown',
  }, null, 2);
  async function copy() {
    try {
      await navigator.clipboard.writeText(diagnostic);
      setCopyStatus('コピーしました');
    } catch { setCopyStatus('コピーできませんでした。下の情報を選択してコピーしてください。'); }
  }
  return <details class="mist-build-banner">
    <summary>
      <strong>{development ? 'DEVELOPMENT' : 'MISTLIB'}</strong>
      <span>mistlib {build.info?.version ?? 'version 不明'} · {build.source}</span>
      {build.info && <code>{build.info.commit.slice(0, 8)}{build.info.dirty ? '+dirty' : ''}</code>}
      <span>{stateLabel}</span><span class="mist-build-more">詳細</span>
    </summary>
    <div class="mist-build-details">
      <p>既存の接続処理が読み込んだ WASM の情報です。依存セットとの照合とバージョン切り替えは未実装です。</p>
      {build.state === 'waiting' && <p>アプリが mistlib を初期化すると更新されます。</p>}
      {build.state === 'unverified' && <p>この版では情報 API が使えないか、返された情報を確認できませんでした。</p>}
      <button type="button" onClick={copy}>診断情報をコピー</button>
      <span role="status">{copyStatus}</span>
      <pre tabIndex={0} aria-label="mistlib 診断情報">{diagnostic}</pre>
    </div>
  </details>;
}
