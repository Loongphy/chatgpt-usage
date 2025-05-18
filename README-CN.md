# OpenAI 用量分析器

[English Readme](./README.md)

## 项目目的

由于 ChatGPT（特别是像 "o3" 这类推理模型）存在用量限制，本项目旨在帮助您分析您的 ChatGPT 使用数据。通过处理您导出的对话数据，您可以了解您的模型使用模式。

## 使用方式

1. **导出您的数据**：
    * 前往您的 ChatGPT 账户设置。
    * 请求导出您的数据。
    * 您会收到一封包含下载链接的电子邮件。

2. **准备 `conversations.json` 文件**：
    * 下载导出的数据（通常是一个 `.zip` 文件）。
    * 解压缩该文件，您应该能在其中找到 `conversations.json` 文件。
    * 将此 `conversations.json` 文件放置在与 Python 脚本（`main.py`, `main2.py`）相同的目录下。

3. **运行分析脚本**：
    * 分析**所有**对话数据：

        ```bash
        python main.py
        ```

        结果将记录在 `main.log` 文件中。

    * 分析**最近一周**的数据：

        ```bash
        python main2.py
        ```

        结果将打印到控制台。

## 脚本说明

* `main.py`：处理整个 `conversations.json` 文件，并记录详细的模型使用统计信息，包括总体统计和每个对话的统计。
* `main2.py`：处理 `conversations.json` 文件，但会筛选出最近七天内的消息，提供近期模型使用情况的摘要。
