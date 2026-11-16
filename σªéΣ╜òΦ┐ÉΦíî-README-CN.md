# UTS Housing & Roommate Finder — 在 Mac 上运行

解压后会得到 `FYPII` 文件夹，里面有：
- `uts-housing-frontend/`：前端（React）
- `uts-housing-backend/`：后端（Node.js + PostgreSQL）
- `docs/`：需求对照表和 API 文档
- `README.md`：英文说明

## 第一次运行（只需要做一次）

### 1. 安装工具

- **Node.js 20 或以上**：到 https://nodejs.org 下载 LTS 版本安装。
- **PostgreSQL 16**，二选一：
  - **用 Docker（推荐）**：安装 Docker Desktop，然后在 `FYPII` 文件夹里执行 `docker compose up -d`。数据库和测试数据库都会自动建好，可以直接跳到第 2 步。
  - **用 Homebrew**：
    ```
    brew install postgresql@16
    brew services start postgresql@16
    psql postgres -c "CREATE USER uts WITH PASSWORD 'uts_dev_password' CREATEDB;"
    psql postgres -c "CREATE DATABASE uts_housing OWNER uts;"
    psql postgres -c "CREATE DATABASE uts_housing_test OWNER uts;"
    ```

### 2. 设置后端

打开「终端」，进入解压后的文件夹（路径换成你自己的）：
```
cd ~/Downloads/FYPII/uts-housing-backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
```

### 3. 安装前端
```
cd ../uts-housing-frontend
npm install
```

## 每次启动

开两个终端窗口：

- 终端 1（后端）：`cd ~/Downloads/FYPII/uts-housing-backend && npm run dev`
- 终端 2（前端）：`cd ~/Downloads/FYPII/uts-housing-frontend && npm run dev`

然后用浏览器打开 http://localhost:5173

如果用 Docker 跑数据库，开机后记得先打开 Docker Desktop。

## 演示账号

| 身份 | 登录方式 | 密码 |
|---|---|---|
| 学生 | 学号 `BCS24020031` + 邮箱 `bcs24020031@student.uts.edu.my` | `Demo@2026` |
| 房东 | `wong@example.com` | `Demo@2026` |
| 管理员 | 点登录页的 "Staff login"，邮箱 `admin@uts-housing.local` | `Admin@2026!` |
| 律师审核员（虚构） | 点登录页的 "Staff login"，邮箱 `reviewer@uts-housing.local` | `Review@2026!` |

演示数据（人名、房源、地址、评价）都是虚构的。执行 `npm run db:seed` 会把演示数据恢复到初始状态。

## 其他

- 运行后端测试：在 `uts-housing-backend` 里执行 `npm test`（需要 `uts_housing_test` 数据库）。
- 验证邮件和重设密码邮件不会真的寄出，内容会显示在后端终端里，也会写进 `uts-housing-backend/logs/mail.log`。
- 完整代码也在 GitHub：仓库 matcusting/FYPII 的 `claude/jolly-edison-1vzpxr` 分支。
