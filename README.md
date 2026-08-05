# POKER LAB 分享与发布

在线访问：`https://blkmanba1.github.io/poker-lab-gto-trainer/`

## 训练内容

- **题目练习**：混合、翻前、翻后三种题库模式，提交后显示教学频率和决策理由。
- **实战桌**：模拟 6 人桌，庄位每手轮转；使用浏览器加密随机源洗入完整 52 张牌，同一手不会重复发牌。
- **逐街反馈**：翻前、翻牌、转牌、河牌均由你选择行动，选择后才显示教学推荐线路、理由和下一街计划。
- **摊牌判断**：使用本地打包的 `pokersolver 2.1.4` 计算牌型和胜负，第三方 MIT 许可见 `vendor/pokersolver.LICENSE.md`。
- **错题本**：偏离题目基线的固定题会自动收录；所有成绩与错题只保存在使用者自己的浏览器中。

## 最省事：直接发送文件

把 `poker-lab-share.zip` 发给朋友。对方解压后双击 `index.html` 即可使用，不需要安装软件，也不需要联网。

不要只单独发送 `index.html`，实战桌还需要同目录下的 `live-practice.css`、`live-practice.js` 和 `vendor` 文件夹。

## 推荐：发布成公开网址

### 方法一：GitHub Pages

1. 登录 GitHub，新建一个公开仓库，例如 `poker-lab`。
2. 把本目录的 `index.html` 上传到仓库根目录。
3. 打开仓库的 `Settings`，进入 `Pages`。
4. 在 `Build and deployment` 中选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/ (root)`，然后保存。
6. 等待约 1-3 分钟，GitHub 会显示公开网址，通常是：

   `https://你的用户名.github.io/poker-lab/`

发布后，页面右上角的分享按钮会调用手机系统分享菜单；不支持系统分享时会复制当前网址。

### 方法二：Netlify Drop

1. 打开 `https://app.netlify.com/drop`。
2. 把整个 `gto-trainer` 文件夹拖到网页中。
3. 上传完成后会立即获得一个公开网址。

这种方式更快，但若要固定站点名称或长期管理，通常需要登录 Netlify。

## 更新网站

- GitHub Pages：更新 `index.html`、`live-practice.css`、`live-practice.js` 和 `vendor` 目录并提交，网址不变。
- Netlify Drop：把更新后的文件夹重新拖入站点部署页面。

## 数据说明

页面中的频率和随机实战建议是用于练习决策结构的教学基线，不是指定抽水、下注树和范围条件下的精确 Solver 输出。公开分享时建议保留页面现有的数据边界说明。

练习成绩和错题本保存在使用者自己的浏览器 `localStorage` 中，不会上传到 GitHub，也不会在不同设备之间自动同步。
