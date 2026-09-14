# Personal DSH distribution

[English](README.md) | 中文

本目录为该 fork 添加可独立安装的 [dsh-codex 组合包](dsh-codex/README.zh.md)。上游包与发布脚本保留原有布局。支持的部署环境为 Linux、Node.js 24、pnpm，以及 PATH 中的 Codex CLI 0.154.0。

## Install from this fork

使用将来运行 DSH 的账号，在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm run build
node personal/install.mjs
pnpm dsh --profile web
```

安装器将本地组合包加入 web profile，创建 Codex 预设，并为编译后的 Session 模块与原生命令菜单应用必要的兼容修正。已有安装的 commands 包版本必须与本仓库一致；请先构建本仓库。它不会启动或重启服务。请保留仓库所在路径，因为 profile 会链接其中的插件目录。启动后在 DSH 中配置提供方和凭据。

安装与启动前可设置 `DSH_HOME`、`DSH_PROFILE`、`CODEX_HOME` 或 `CODEX_BIN`，分别指定数据目录、profile、原生会话目录或 Codex 可执行文件。默认使用当前账号，不包含服务器地址或凭据。被覆盖的预设或编译后的 Session/commands 模块，会按内容生成一份小型备份，保存在 `$DSH_HOME/backups/dsh-codex`。

对于已安装的 DSH，提供准确的包清单与可执行文件路径：

```bash
DSH_PACKAGE_JSON=/path/to/dsh/package.json DSH_BIN=/path/to/dsh node personal/install.mjs --installed
```

## Update

拉取该 fork、安装锁定的依赖、构建，然后重新运行安装器，再重启 DSH。构建会替换编译产物中的兼容修正，因此每次构建后都要重新运行安装器。仅更新仓库不会更新已经运行的服务器。

该个人 fork 已关闭 GitHub Actions。后续推送若不希望触发工作流，请保持关闭；仅使用提交跳过标记无法覆盖所有事件类型。参见[集成决策](../.agents/notes/implemented/architecture/2026-09-14-personal-codex-bundle.zh.md)。
