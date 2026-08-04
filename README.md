# POKER LAB 分享与发布

在线访问：`https://blkmanba1.github.io/poker-lab-gto-trainer/`

## 最省事：直接发送文件

把 `index.html` 发给朋友。对方下载后双击即可使用，不需要安装软件，也不需要联网。

这种方式适合少量熟人，但聊天软件可能会拦截 HTML 附件。遇到这种情况，发送同目录下的 `poker-lab-share.zip`。

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

- GitHub Pages：替换仓库中的 `index.html` 并提交，网址不变。
- Netlify Drop：把更新后的文件夹重新拖入站点部署页面。

## 数据说明

页面中的频率是用于练习决策结构的教学基线，不是指定抽水、下注树和范围条件下的精确 Solver 输出。公开分享时建议保留页面现有的数据边界说明。
