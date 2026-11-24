# 読書記録の同期とMCP

既存のWebアプリと同じオリジン・パスで配布する。別オリジンのプレビューは端末の既存ライブラリー・一時画像を参照できない。iOS署名・TestFlightは使用しない。

## 書き込みと読み取り
1. データ用Supabaseで先に既存ポリシー、Data API、Storageを点検し、data.sqlを1トランザクションで適用する。Googleログインを設定し、実際のアプリの正確なコールバックURLを許可する。管理者が本人と照合したauth.users.idをreading_private.ownerに1件だけ登録する。公開セルフ登録に権限は付かない。
2. デプロイ時にcloud/config.jsonのurlとpublishableKeyをデータ側の公開可能設定で置換する。配布物には管理者鍵を含めない。リポジトリの既定設定では接続は無効。短時間の直接ログインで書き込み、期限切れは再認証。書籍名とローカル書籍IDを同期し、チャットURLは端末に保持する。インポートで再生成されたIDは別の本として扱う。
3. 共通認証側にpermissions.sqlを一度適用する。reading_auth.ownerとallowed_clientには本人・登録済みコールバック・同意を確認したクライアントだけを個別登録する。既存ポケカの許可と自動連動しない。
4. データ側にreader.tsをreading-readerとして配布する。別プロジェクト発行トークンを受ける場合はプラットフォームのverify_jwtを無効にし、関数内で固定の認証元に毎回再照会する。READING_ISSUER_URLとREADING_ISSUER_PUBLIC_KEYをサーバー設定に登録する。SUPABASE_SERVICE_ROLE_KEYはデータ側のサーバー内だけで使う。
5. 共通MCPの稼働版を取得し、tools.tsを同梱して以下をserver.connectの前に追加する。既存のOAuth発見・Streamable HTTP・Google同意を利用する。READING_READER_URLは管理者が設定したデータ側の関数URL。登録と呼び出しの両時点で読書権限を確認する。

```ts
import { attachReading } from './tools.ts';
// Inside the authenticated request handler:
await attachReading(server, auth, Deno.env.get('READING_READER_URL'),
  () => db.rpc('reading_mcp_allowed'));
```

6. 試験は架空の書籍・自作画像を使い、Google本人以外の拒否、OAuthトークンでの直接書込拒否、Storage匿名取得拒否、各クライアントのtools/listと同じメモ・進捗の読み出しを照合する。ログには本文、個人のメモ、トークン、署名URLを残さない。新しいAIに共通入口を許可する場合、既存の健康ツールも列挙され得るため、そのクライアントの既存データへの権限を個別に確認する。
7. 読書の利用停止はreading_auth.allowed_clientの該当行を無効化する（現設計では削除）。読書の書き込み停止はデータ側の所有者登録解除で行う。障害時は読み取り登録部分を外すかREADING_READER_URLを解除し、既存共通MCPの稼働版に戻す。復旧のためにデータやバケットを削除する必要はない。

## 記録単位
同期ボタン1回で選択中の本・最終既読ページ・自分のメモ・撮影セットの情報を記録。内容を変えた再登録は新しいスナップショット。完全に同じ入力の再試行は同一ID。「別の読書セッションを始める」で同じ内容の再読を区別できる。時刻は登録時刻。画像に印刷されたページ番号・撮影日時・読書時間は推定しない。別の本へ切り替えたら入力範囲と撮影セットを確認する。

画像は明示選択した場合だけ元JPEGを非公開Storageへ直接転送。ハッシュによる重複排除と順序付きの一覧を使う。途中で切断された場合は同じセットで再試行する。登録前に中断した画像が残ることがあり、自動削除は行わない。get_book_pagesは提供しない。MCPの読取結果にURLや画像ハッシュは含まれない。

## 壁打ちの再開
「最後に読んだページと前回の自分のメモを確認して、保留していた問いを一つ返して」で開始できる。別のAIでも同じ本のIDでget_reading_progressとget_reading_sessionsを読み合わせる。AIとの対話後に残す本人の気づきはpersonal-ai-knowledgeの読書索引・既存insightsを照合し、差分だけDraft PRにする。会話や書籍本文の自動転記、MCPからの書き込みは行わない。
