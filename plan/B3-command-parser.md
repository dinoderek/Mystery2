We want to improve the command parser in the Web UI.

Objectives:
- WebUI parses and validates commands intelligently
- WebUI sends only valid commands to backend
- WebUI provides clear feedback to user on invalid commands
- WebUI handles backend errors gracefully, has retries for transient errosr, and provides clear feedback to user

Details
- Simple parser for commands that looks at the first few words to determine the command type
- Add aliases for common commands (e.g. "go to", "move to", "travel to", "head towards")
- For commands that require a target, add validation to ensure the target is a valid character or location. Match against location name, character first name OR surname.
- When command is not recognized, show list of commands and show option of help
- When command is recognized but target is not, show list of valid targets
- For location specifically, show both locations and characters at location
- Parsing needs to be mode-aware
- We shold not forget system commands (accuse, quit, help)
