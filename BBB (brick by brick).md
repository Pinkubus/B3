BBB (brick by brick)

A vscode extension that, when making changes to a project via copilot, instead of just making the changes itself, it prompts the user to press hotkeys for optimal navigation(and if the user customizes their hotkeys it knows, keeps track of current keyboard shortcuts) and tells the user what to type.

Example: User asks copilot to code a python function that counts from 1 to 3.
The user is provided a screen overlay prompt at the center of the screen or something saying "Press ctrl+shift+b(hides copilot)" 
the user presses that, is then prompted on how to navigate to the file being altered. Both the shortcut for focusing on the file window/workspace, then on how to navigate to the tab for the file being altered if that file is not currently the one the user is currently tabbed into.
The user is now in the file, they are prompted to press ctrl+g+(line number)
the user is prompted to type the first line of the code, and to press enter to make the parenthesis move to a new line at the end of the line or something, then ctrl+g or down arrow to navigate to the next line, prompted with tab to tab over for proper indentation, detects when indendation is correct, then tells the user what to type..


and so on.

