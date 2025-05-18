# OpenAI Usage Analyzer

[中文说明 (Chinese Readme)](./README-CN.md)

## Purpose

This project helps analyze your ChatGPT usage data, particularly in light of usage limits (e.g., for "o3" inference models). By processing your exported conversation data, you can get insights into your model utilization patterns.

## Usage

1. **Export Your Data**:
    * Go to your ChatGPT account settings.
    * Request an export of your data.
    * You will receive an email with a download link.

2. **Prepare `conversations.json`**:
    * Download the exported data (usually a `.zip` file).
    * Unzip the file. You should find a `conversations.json` file inside.
    * Place this `conversations.json` file in the same directory as the Python scripts (`main.py`, `main2.py`).

3. **Run Analysis Scripts**:
    * To analyze **all** your conversation data:

        ```bash
        python main.py
        ```

        The results will be logged to `main.log`.

    * To analyze data from the **last 7 days**:

        ```bash
        python main2.py
        ```

        The results will be printed to the console.

## Scripts

* `main.py`: Processes the entire `conversations.json` file and logs detailed model usage statistics, both overall and per conversation.
* `main2.py`: Processes `conversations.json` but filters for messages from the last seven days, providing a summary of recent model usage.
