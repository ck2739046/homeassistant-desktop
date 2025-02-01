# Home Assistant - Desktop

Desktop App (Windows / macOS / Linux) for [Home Assistant](https://www.home-assistant.io/) built with [Electron](https://www.electronjs.org)

![Home Assistant - Desktop](https://raw.githubusercontent.com/DustyArmstrong/homeassistant-desktop/master/media/screenshot.png)

This project is fork from [iprodanovbg/homeassistant-desktop](https://github.com/iprodanovbg/) and [mrvnklm/homeassistant-desktop](https://github.com/mrvnklm/). 

## Project Status

The status of the project with regards to its original maintainers is unknown - the original author ([mrvnklm](https://github.com/mrvnklm/)) has seemingly deleted their repository and the most well-developed version by [iprodanovbg](https://github.com/iprodanovbg/) has not had any meaningful updates since February 2023. Due to loss of functionality from aging dependencies I simply opted to fork the repository and make the necessary changes since I used the app every day, though it has since increased in scope. This project will be maintained so long as there is a need or desire to, so pull requests to improve or fix functionality are most welcome here.

I hope this project can be of some use to others if you like/liked the app! Issues are open to submit if you have any, though please be aware I may not be able to resolve all issues quickly or comprehensively - I will do my best.

## Installation

Just download the latest version for your platform from the [release section](https://github.com/DustyArmstrong/homeassistant-desktop/releases/latest) and install!

## Usage / Features

- hover / click the tray icon to open the app
- supports multiple instances of Home Assistant (including automatic switching)
- automatic instance discovery using bonjour
- automatic reconnection to your instance on connection loss
- right-click context menu for settings / reset / quit the app
- global keyboard shortcut (defaults to Cmd/Ctrl + Alt + X but can be changed) can be enabled to show / hide Home Assistant
- fullscreen mode (Cmd/Ctrl + Alt + Return)
- automatic update checks (if not disabled in context menu)

## Notes & known issues

- at present support for self-signed certificates is YMMV (I recommend using Let's Encrypt to resolve this, though it is something I'll try to work on)
- support for Linux distros may vary, app tested on Debian-based flavors (XORG) but detailed feedback is welcome
- support for Wayland is limited - the application will still run however a number of Electron's features aren't implemented yet (e.g. shortcuts, checkbox display)
- if using "detached window" on Windows, instead of dragging, you have to resize it to move it

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License and Author

Copyright 2024, [Dusty Armstrong](https://github.com/DustyArmstrong)\
Copyright 2022, [Ivan Prodanov](https://github.com/iprodanovbg)\
Copyright 2020-2021, [Marvin Kelm](https://github.com/mrvnklm)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
