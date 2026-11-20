# 可选眼动模块：保留、替换或移除

这是本次在 EMG 项目中加入的摄像头眼动实现，不是组员原来的眼动项目。EMG、眼动测试位置都没有移动。所有修改都在 EMG 内，其他项目文件夹保持原样。

## 里面有什么

- camera-gaze.mjs：WebGazer 摄像头接入与有效眼部帧检查。
- calibration-ui.mjs：原位置的九点点击校准和五点独立验证。
- gaze-calibration.mjs：有效训练帧、验证采样数量与误差判定。
- camera-assets.mjs：本地模型资源检查和相机停止清理。
- vendor：WebGazer 和原始许可证。
- mediapipe：本地 FaceMesh 模型及运行文件，无需额外安装软件。

## 暂时保留

默认保留整个文件夹。启动 EMG 后，Gaze source 中的 WebGazer · camera gaze 继续使用这里的代码。

## 与组员的版本冲突时

1. 先停止游戏或录制，Export ZIP 并确认保存，关闭网页及启动服务器。
2. 可以把整个 OPTIONAL_EYE_TRACKING 改名为 OPTIONAL_EYE_TRACKING.disabled，先验证效果。确认不需要后再自行删除这一整个文件夹即可。
3. 重新启动 EMG。摄像头 WebGazer 选项会停用；Arduino 肌电、鼠标选择和 External eye tracker 接口仍然保留，不会因为缺少这里的模型而导致页面无法加载。
4. 要恢复，把文件夹名称改回 OPTIONAL_EYE_TRACKING，再重启页面和服务器。

不要删除整个 web/lib 或 web/emg-integration.mjs，它们还负责真实 EMG、游戏推进、鼠标与外部输入桥接。无需改动 Arduino 固件，也不要覆盖组员自己的眼动文件夹。

## 接入组员的眼动结果

若组员代码已经能输出屏幕注视坐标，EMG setup 的 Gaze source 选择 External eye tracker · adapter input。组员适配器在同一游戏页面调用 window.BN5213Inputs.pushGaze，传入 x、y（相对当前浏览器可视区域的 CSS 像素）、valid 和来源 source；具体格式见 EMG/docs/INTEGRATION.md。完成组员自己的校准和坐标核查后，才确认面板中的 External tracker calibration and viewport coordinates verified。

删除这里的文件夹只移除本次自带的摄像头实现，不会自动把另一份眼动程序连入游戏。外部程序若运行在不同进程或页面，仍需组员提供坐标适配连接。

## 图片中的验证失败

旧提示无法区分“有效预测太少”和“定位不够准”。这里的新版会显示每个验证点的样本数，并在样本足够时显示像素误差与允许误差。没有有效眼部特征的点击不会累计校准次数；低帧率时每点最多等待四秒。通过标准没有放宽。
