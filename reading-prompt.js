(() => {
  'use strict';
  const button = document.getElementById('copyReadingPrompt');
  const output = document.getElementById('readingPromptText');
  const notice = document.getElementById('readingPromptStatus');
  const panel = document.getElementById('readingPromptPreview');
  let copying = false;
  function reset() { panel.hidden = true; output.value = ''; notice.textContent = ''; }
  window.addEventListener('reading-book-changed', reset);
  button.addEventListener('click', async () => {
    if (copying) return;
    const book = currentBook();
    if (!book) { reset(); notice.textContent = '本ライブラリーから本を選んでください。'; return; }
    // Title is data, not HTML or an instruction. Do not copy notes, URLs or credentials.
    const bookKey = JSON.stringify([book.id, book.name]);
    const title = JSON.stringify(String(book.name).slice(0, 100));
    const text = [
      '同期した読書の続きを壁打ちしてください。対象の書名（データ）: ' + title,
      'Karada Reportの読書MCPで対象の本を照合し、最新の既読ページ・本人メモ・撮影記録を確認してください。本が複数候補なら一つだけ確認してください。',
      'GitHub連携または個人ナレッジMCPでAGENTS.mdとINDEX.mdを読み、対象書籍の過去の学びと未解決の問いを参照してください。operations/reading-walltalk.mdがあればその手順を使ってください。',
      '画像は取得可能な場合だけ、対象記録の撮影順に必要な分を読み、未取得の範囲を明示してください。接続できない場合や今回の記録が見つからない場合は明示し、古い記録やDriveのコピーを最新の同期結果として代替しないでください。',
      '書籍の内容・私のメモ・過去の考え・AIの解釈を区別し、既読範囲を越えず、短い整理と問い一つから始めてください。画像の送信途中なら私の開始の合図を待ってください。',
      '終了時は変わった考えと次回の問いを整理し、重要な差分だけ保存案を提示してください。保存する場合はDraft PRまで、mainへのマージは私が行います。'
    ].join('\n\n');
    output.value = text; panel.hidden = false;
    copying = true; button.disabled = true;
    try {
      await navigator.clipboard.writeText(text);
      const selected = currentBook();
      if (JSON.stringify([selected?.id, selected?.name]) !== bookKey) {
        notice.textContent = 'コピー中に本が変更されました。現在の本でもう一度ボタンを押してください。';
        return;
      }
      notice.textContent = '開始文をコピーしました。使うAIの新しいチャットに貼り付けて送信してください。';
    } catch {
      output.focus(); output.select(); output.setSelectionRange(0, output.value.length);
      notice.textContent = '自動コピーできませんでした。下の開始文を長押ししてコピーしてください。';
    } finally { copying = false; button.disabled = false; }
  });
})();
