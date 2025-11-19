# ChatGPT 脚本

一批用于优化ChatGPT网页端体验的油猴脚本集合。

## 脚本汇总

### 平滑圆角输入框 [chat_squircle.user.js](./chat_squircle.user.js)
- **功能描述**: 为 ChatGPT, Gemini, Grok, AI Studio 等 AI 聊天平台的输入框引入 `corner-shape: squircle` CSS 特性。相比标准的 `border-radius`，它提供了数学上更连续、视觉上更平滑的“超椭圆”圆角（类似 iOS 图标风格）。
- **注意**: 需要浏览器支持实验性 CSS 属性（可能需在 `chrome://flags` 中开启 `Experimental Web Platform features`）。

<table>
  <tr>
    <td align="center">
      <b>ChatGPT</b><br>
      <img src="./images/chatgpt_input.png" width="100%" alt="ChatGPT Squircle Input">
    </td>
    <td align="center">
      <b>Google Gemini</b><br>
      <img src="./images/gemini_input.png" width="100%" alt="Gemini Squircle Input">
    </td>
  </tr>
  <tr>
    <td align="center">
      <b>Grok</b><br>
      <img src="./images/grok_input.png" width="100%" alt="Grok Squircle Input">
    </td>
    <td align="center">
      <b>Google AI Studio</b><br>
      <img src="./images/aistudio_input.png" width="100%" alt="AI Studio Squircle Input">
    </td>
  </tr>
</table>

### 聊天导航 [chat-navigation.js](./chat-navigation.js)
- **功能描述**: 罗列每个用户、ChatGPT对话，显示在悬浮栏中，方便切换每个对话。
- **更新建议**: 使用当前项目版本

<img width="3703" height="1378" alt="image" src="https://github.com/user-attachments/assets/e6700221-81f2-4b69-aaa4-7e6c5d61db2d" />

### 使用监控 [usage-monitor.user.js](./usage-monitor.user.js)
- **功能描述**: 记录在当前浏览器使用的模型次数
- **更新建议**: 使用当前项目版本，建议在油猴脚本管理器中禁用自动更新

<img width="3355" height="1918" alt="image" src="https://github.com/user-attachments/assets/0d53919d-9347-46d0-ad45-e7afeacc08e5" />

### 快捷短语 [gpt-shortcuts.user.js](./gpt-shortcuts.user.js)
- **功能描述**: 快速插入预定义短语
- **更新建议**: 使用当前项目版本

<img width="2623" height="970" alt="image" src="https://github.com/user-attachments/assets/d6b1f9d0-729a-49d4-9b7d-cc70d7bcf16e" />

## 模型用量分析
获取ChatGPT数据 → 运行分析脚本

### 步骤：
1. 从设置中导出ChatGPT数据
2. 提取 `conversations.json`
3. 运行分析脚本

- 完整历史分析

```bash
python main.py
```

- 最近7天分析  
```bash
python main2.py
```

## 版权说明

当前仓库仅为原脚本的体验优化版本，所有脚本的版权归原作者所有。本仓库提供的脚本基于公开的原始脚本进行体验改进。