# 个人战斗力成长系统

纯静态手机网页，使用 HTML/CSS/JavaScript 和 LocalStorage 保存数据。

## 本地打开

直接打开 `index.html` 即可使用。也可以启动静态服务：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080/`。

## GitHub Pages 发布

1. 在 GitHub 创建一个仓库，例如 `combat-power`。
2. 把本目录文件推送到仓库的 `main` 分支。
3. 仓库里已包含 `.github/workflows/pages.yml`，推送后会用 GitHub Actions 发布 Pages。
4. 发布完成后网址通常是：

```text
https://你的用户名.github.io/combat-power/
```

## 数据备份

数据保存在当前设备、当前浏览器的 LocalStorage 中。请定期进入「设置」页点击「导出数据」保存 JSON 备份。换手机或清理浏览器数据前，先导出备份，再用「导入数据」恢复。
