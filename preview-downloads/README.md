# Windows Chrome 演示包

从 GitHub 下载 `FYPII-Windows-Chrome-preview.zip`，在 Windows 文件管理器中右键选择“全部解压”，然后在解压后的文件夹中双击 `START-WEBSITE.cmd`。使用网站期间保持 **UTS Housing Preview Server** 窗口开着。启动文件会尝试自动打开 Chrome；如未打开，请在同一台电脑的 Chrome 输入 `http://127.0.0.1:4173/`。

ZIP 内含已构建的前端、内存演示 API，以及官方 Windows x64 Node.js v20.19.5 运行程序；无需安装 Node.js 或运行 `npm`。ZIP 的 SHA-256 为：

```text
deb149b5087660ecd0d92d0ea2f48155b27141ebaaac6740e3e532cac90c164c
```

演示账号为 `student@demo.local`、`landlord@demo.local`、`admin@demo.local`，以及待认证学生 `verification-demo@student.uts.edu.my` 和待认证房东 `landlord-applicant@demo.local`；密码均为 `Demo12345!`。所有数据均为虚构示例，重启服务后恢复初始状态。网站默认显示英文，可切换马来文或简体中文。这个 ZIP 使用独立的内存演示服务；仓库中的 Express/PostgreSQL 后端需按根目录 README 另行启动。

此版本已移除 Google Maps，改为房东填写完整房屋地址，并增加设施选项和房东电话资料。

学生个人资料新增可选电话号码；“寻找室友”会直接打开 My Lifestyle Profile，大学信息不会显示给匹配对象。

待认证学生账号可以演示上传学生证照片和录取通知书，再由管理员审核。ZIP 不发送验证邮件，也不保存上传的文件；管理员下载的是通用占位图。请只使用虚构测试文件，勿上传真实证件。

待认证房东账号可以演示上传身份和逐房源出租授权资料，分别由管理员审核，再提交房源。也可使用新的 `@demo.local` 邮箱和密码 `Demo12345!` 模拟房东注册；网页会提供本机模拟邮箱验证链接。演示服务器不发送邮件、不保存上传文件，管理员下载的也是通用占位图。请勿上传真实身份证、产权或租约材料。正式 API 的认证和私有存储请依根目录 README 本机启动。

还可以使用未用过的 `demo-...@student.uts.edu.my` 模拟新学生注册。预览版会在页面提供模拟验证邮件和密码重设链接，不会发送真实邮件；学生证与录取通知书上传内容会立即丢弃。管理员界面现有房东/房屋授权有效期与撤销、账户删除申请、审计日志入口。学生认证批准须由管理员手动确认学生证学号与邮箱前缀相符，预览不提供 OCR 或真实学籍查询。
