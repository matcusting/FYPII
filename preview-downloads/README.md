# Windows Chrome 演示包

从 GitHub 下载 `FYPII-Windows-Chrome-preview.zip`，在 Windows 文件管理器中右键选择“全部解压”，然后在解压后的文件夹中双击 `START-WEBSITE.cmd`。使用网站期间保持 **UTS Housing Preview Server** 窗口开着。启动文件会尝试自动打开 Chrome；如未打开，请在同一台电脑的 Chrome 输入 `http://127.0.0.1:4173/`。

ZIP 内含已构建的前端、内存演示 API，以及官方 Windows x64 Node.js v20.19.5 运行程序；无需安装 Node.js 或运行 `npm`。ZIP 的 SHA-256 为：

```text
36c7be74abefe02abde4075d18aa922c96d106c22f70f862763fc327586bd539
```

演示账号为 `student@demo.local`、`landlord@demo.local`、`admin@demo.local`，密码均为 `Demo12345!`。所有数据均为虚构示例，重启服务后恢复初始状态。网站默认显示英文，可切换马来文或简体中文。这个 ZIP 使用独立的内存演示服务；仓库中的 Express/PostgreSQL 后端需按根目录 README 另行启动。

此版本已移除 Google Maps，改为房东填写完整房屋地址，并增加设施选项和房东电话资料。

学生个人资料新增可选电话号码；“寻找室友”会直接打开 My Lifestyle Profile，大学信息不会显示给匹配对象。
