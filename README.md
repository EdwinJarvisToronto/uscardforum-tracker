# USCardForum Badge Tracker

在浏览器或本地终端中读取自己的 Discourse 用户归档，查看 USCardForum 徽章进度。网页完全静态，文件只在当前浏览器标签页中处理，不会上传或保存。

## 网页版（GitHub Pages）

需要 Node.js 20.19 或更高版本（也支持 22.12+）：

```bash
npm install
npm run dev
```

Vite 会输出本地访问地址。网页支持直接选择完整归档 ZIP，或解压后的 `user_archive.csv`。

生产构建：

```bash
npm test
npm run build
```

静态文件生成在 `apps/web/dist/`。Vite 使用相对资源路径，因此既能部署在 `username.github.io/repository/`，也能部署到自定义域名。

仓库包含 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)。关联 GitHub 仓库并 push 后，在仓库的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**，后续推送到 `main` 会自动测试并部署。当前项目不会自行创建或关联远端仓库。

## 终端版

终端版只需要 Python 3.9 或更高版本，不安装第三方依赖：

```bash
python3 badge_tracker.py
```

也可以明确指定解压目录、CSV 或 ZIP：

```bash
python3 badge_tracker.py /path/to/user_archive-username-date
python3 badge_tracker.py /path/to/user_archive.csv
python3 badge_tracker.py /path/to/user_archive-username-date.zip
```

无参数运行时，程序会递归查找名称为 `user_archive.csv` 的文件及 `user_archive-*.zip`，并使用修改时间最新的一份。

## 项目结构

```text
packages/core/   ZIP / CSV 解析、徽章规则和计算逻辑
apps/web/        GitHub Pages 静态网页
badge_tracker.py Python 终端版
badge_rules.json 两个版本共用的徽章规则
```

`packages/core` 不依赖具体 UI，后续 Chrome / Safari 扩展可以复用同一套解析和计算逻辑。

## 测试

```bash
npm test
npm run typecheck
python3 -m unittest discover -s tests -v
```

## 隐私与安全

- ZIP 和 CSV 只在当前浏览器标签页内读取，不会发送到服务器。
- 网页只解压 ZIP 中的 `user_archive.csv`，不读取认证日志等其他文件。
- 解析后只保留点赞数的匿名汇总，不保留帖子正文、标题、URL 或用户名。
- v0.1 不使用 `localStorage`，刷新或关闭页面后结果消失。
- 构建产物不包含分析脚本、第三方字体或运行时 CDN 依赖。
- 页面载入时会向 GitHub 公共 API 发出一次不带登录凭证的只读请求，用来显示仓库 Star 数；GitHub 会收到 IP、User-Agent 等常规网络元数据，但不会收到归档、用户名或计算结果，失败也不影响使用。
- 为兼顾手机内存，v0.1 限制 ZIP 为 50 MB、目标 CSV 为 30 MB；更大的归档可以在解压后拆出必要 CSV 再尝试。
- GitHub Pages 仍可能按其自身政策记录普通页面访问元数据，但所选文件和计算结果不会传输。

Discourse 用户归档可能包含私信、认证记录、IP 地址等敏感信息。`.gitignore` 已排除 `user_archive*` 目录、CSV、ZIP 和 `data/`；不要强制把这些文件加入 Git。
