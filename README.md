# Gemini CLI Chat for Visual Studio Code

[English](#english) | [Tiếng Việt](#tiếng-việt)

---

## English

### Overview
Gemini CLI Chat is a sophisticated Visual Studio Code extension designed to integrate Google Gemini intelligence directly into the development environment. Built upon the Agentic Control Protocol (ACP) and supporting the Model Context Protocol (MCP), this extension enables advanced AI agents to perform deep codebase analysis, execute localized tools, and streamline complex engineering workflows.

### Key Features
- **Specialized AI Agents**: Integrated support for multiple agent profiles, including the Codebase Investigator for architectural analysis, CLI Helper for technical documentation retrieval, and Generalist for standard development tasks.
- **Protocol Integration**: Full compatibility with ACP and MCP, allowing for extensible tool-use capabilities such as file system operations and comprehensive search functionality.
- **Context Management**: Robust systems for incorporating file attachments, directory structures, and active editor selections into the large language model context.
- **Session Architecture**: Persistent management of multiple independent chat sessions with full state preservation.
- **Operational Modes**: Dual-mode execution consisting of Plan Mode for architectural design and Act Mode for implementation and code modification.
- **User Interface**: High-performance, webview-based interface optimized for responsiveness and technical clarity.

### Keyboard Shortcuts

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| Cmd/Ctrl + Shift + I | Add selected text to context | Editor |
| Cmd/Ctrl + Shift + Q | Toggle Mode (Plan/Act) | Chat View |
| Cmd/Ctrl + Shift + A | Cycle through Agents | Chat View |
| Cmd/Ctrl + Shift + . | Cycle through Models | Chat View |
| Shift + Tab | Rapid Mode switching | Chat View |

### Installation and Configuration
1. **Prerequisites**: Ensure the Gemini CLI is installed and accessible via the system PATH.
2. **Configuration**: Define the CLI binary path and any required API credentials within the VS Code settings under the `geminiCliChat.cliPath` namespace.
3. **Activation**: Access the Gemini interface through the Activity Bar or by executing the `Gemini Chat: Focus Chat` command.
4. **Usage**: Utilize the command-line interface within the webview. Use the `@` symbol for file referencing and `/` for predefined slash commands.

---

## Tiếng Việt

### Tổng quan
Gemini CLI Chat là một tiện ích mở rộng dành cho Visual Studio Code, được thiết kế để tích hợp trực tiếp khả năng xử lý của Google Gemini vào quy trình phát triển phần mềm. Hoạt động trên nền tảng Giao thức Điều khiển Tác tử (Agentic Control Protocol - ACP) và hỗ trợ Giao thức Ngữ cảnh Mô hình (Model Context Protocol - MCP), tiện ích này cho phép các tác tử AI thực hiện phân tích sâu mã nguồn, thực thi công cụ và tối ưu hóa các quy trình kỹ thuật phức tạp.

### Các tính năng chính
- **Tác tử AI Chuyên biệt**: Hỗ trợ nhiều cấu hình tác tử khác nhau, bao gồm Investigator (Phân tích kiến trúc mã nguồn), CLI Helper (Tra cứu tài liệu kỹ thuật) và Generalist (Xử lý các tác vụ phát triển thông thường).
- **Tích hợp Giao thức**: Tương thích hoàn toàn với ACP và MCP, cho phép mở rộng khả năng sử dụng công cụ như thao tác hệ thống tệp và tìm kiếm nâng cao.
- **Quản lý Ngữ cảnh**: Hệ thống xử lý đính kèm tệp, cấu trúc thư mục và dữ liệu từ trình soạn thảo vào ngữ cảnh của mô hình ngôn ngữ lớn một cách hiệu quả.
- **Kiến trúc Phiên làm việc**: Quản lý bền vững nhiều phiên hội thoại độc lập, đảm bảo bảo toàn trạng thái dữ liệu.
- **Chế độ Vận hành**: Quy trình làm việc hai giai đoạn gồm Chế độ Lập kế hoạch (Plan Mode) để thiết kế giải pháp và Chế độ Thực thi (Act Mode) để triển khai mã nguồn.
- **Giao diện Người dùng**: Giao diện dựa trên nền tảng Webview hiệu năng cao, được tối ưu hóa cho sự phản hồi nhanh chóng và tính minh bạch về kỹ thuật.

### Phím tắt hệ thống

| Phím tắt | Hành động | Phạm vi |
| :--- | :--- | :--- |
| Cmd/Ctrl + Shift + I | Thêm vùng chọn vào ngữ cảnh | Trình soạn thảo |
| Cmd/Ctrl + Shift + Q | Chuyển đổi Chế độ (Plan/Act) | Cửa sổ Chat |
| Cmd/Ctrl + Shift + A | Thay đổi Tác tử | Cửa sổ Chat |
| Cmd/Ctrl + Shift + . | Thay đổi Mô hình | Cửa sổ Chat |
| Shift + Tab | Chuyển đổi nhanh Chế độ | Cửa sổ Chat |

### Hướng dẫn Cài đặt và Cấu hình
1. **Điều kiện tiên quyết**: Đảm bảo Gemini CLI đã được cài đặt và có thể truy cập thông qua biến môi trường PATH của hệ thống.
2. **Cấu hình**: Thiết lập đường dẫn thực thi CLI và các thông tin xác thực cần thiết trong phần cài đặt của VS Code tại mục `geminiCliChat.cliPath`.
3. **Kích hoạt**: Mở giao diện Gemini thông qua thanh Activity Bar hoặc sử dụng lệnh `Gemini Chat: Focus Chat`.
4. **Sử dụng**: Tương tác thông qua giao diện hội thoại. Sử dụng ký tự `@` để tham chiếu tệp tin và `/` để thực thi các lệnh nhanh.
