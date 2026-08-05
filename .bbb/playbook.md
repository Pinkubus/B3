1. Open playbookParser.ts.
    <!-- bbb: open file="C:/Users/tylwilli/Desktop/B3/src/playbookParser.ts" -->
    <!-- bbb: explain -->
    ```
    Two small additions here: a counted property on BaseStep, and its default value in the base object every step is built from.
    ```

2. Add the `counted` flag to the BaseStep interface.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookParser.ts" line="22" indent="4" -->
    ```typescript
    counted: boolean;
    ```
    <!-- bbb: explain -->
    ```
    Adds a boolean to every step. When true (the default), the step adds to the N/total fraction in the status bar. When false, it is a nav/keyboard step: it still appears in the lower-left but shows a → prefix and does not advance N or total.
    ```

3. Populate `counted` in the base object that every step is built from.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookParser.ts" line="238" indent="8" -->
    ```typescript
    counted: actionBlock.attrs.counted !== "false",
    ```
    <!-- bbb: explain -->
    ```
    Reads the counted="false" attribute from the <!-- bbb: ... --> directive. Any step without the attribute gets counted=true, so all existing playbooks are unaffected.
    ```

4. Open playbookRunner.ts.
    <!-- bbb: open file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" -->
    <!-- bbb: explain -->
    ```
    Steps 5–11 add two private helpers below updateStatusBar. Steps 12–15 update the status bar display logic to use those helpers.
    ```

5. Add a blank line after updateStatusBar's closing brace.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="249" indent="0" -->
    ```typescript

    ```
    <!-- bbb: explain -->
    ```
    Separator before the new private helpers, matching the style used between methods elsewhere in the file.
    ```

6. Start the countedPosition helper.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="250" indent="4" -->
    ```typescript
    private countedPosition(idx: number): number {
    ```
    <!-- bbb: explain -->
    ```
    This method returns the 1-based position of step idx among all counted steps — the numerator in the N/total status bar display for non-nav steps.
    ```

7. Add the countedPosition body.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="251" indent="8" -->
    ```typescript
    return this.steps.slice(0, idx + 1).filter(s => s.counted).length;
    ```
    <!-- bbb: explain -->
    ```
    Slices the step array through the current index, keeps only counted steps, and returns the count. Step 0 with counted=true → returns 1.
    ```

8. Close countedPosition.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="252" indent="4" -->
    ```typescript
    }
    ```
    <!-- bbb: explain -->
    ```
    Closes the helper method.
    ```

9. Add a blank line before the countedStepsTotal getter.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="253" indent="0" -->
    ```typescript

    ```
    <!-- bbb: explain -->
    ```
    Visual separation between the two helpers.
    ```

10. Start the countedStepsTotal getter.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="254" indent="4" -->
    ```typescript
    private get countedStepsTotal(): number {
    ```
    <!-- bbb: explain -->
    ```
    A getter returning the total number of counted steps — the denominator in the N/total display. Nav steps (counted=false) are excluded, so the total reflects only "real work" steps.
    ```

11. Add the countedStepsTotal getter body and close it.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="255" indent="8" -->
    ```typescript
    return this.steps.filter(s => s.counted).length;
    ```
    <!-- bbb: explain -->
    ```
    Filters to counted=true steps and returns the count.
    ```

12. Close the countedStepsTotal getter.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="256" indent="4" -->
    ```typescript
    }
    ```
    <!-- bbb: explain -->
    ```
    Closes the getter.
    ```

13. Update promptPageMax to size the message area correctly for nav steps.
    <!-- bbb: note -->
    On line 233 in playbookRunner.ts, replace the entire `const raw` line:

    OLD:
        const raw = `$(debug-step-over) BBB ${this.currentIdx + 1}/${this.steps.length}: `;

    NEW:
        const raw = this.steps[this.currentIdx]?.counted === false ? '$(debug-step-over) BBB →: ' : `$(debug-step-over) BBB ${this.countedPosition(this.currentIdx)}/${this.countedStepsTotal}: `;

    The shorter → prefix for nav steps gives more room for their description in the status bar.

14. Replace the status bar text line in updateStatusBar with a prefix variable.
    <!-- bbb: note -->
    On line 245 in playbookRunner.ts, replace the entire `this.statusBar.text` line:

    OLD:
        this.statusBar.text = `$(debug-step-over) BBB ${this.currentIdx + 1}/${this.steps.length}: ${page}${pageTag}`;

    NEW:
        const prefix = this.steps[this.currentIdx]?.counted === false ? '$(debug-step-over) BBB →' : `$(debug-step-over) BBB ${this.countedPosition(this.currentIdx)}/${this.countedStepsTotal}`;

    The next step (15) inserts the actual this.statusBar.text assignment on the line that follows.

15. Insert the new statusBar.text assignment using the prefix variable.
    <!-- bbb: edit file="C:/Users/tylwilli/Desktop/B3/src/playbookRunner.ts" line="246" indent="8" -->
    ```typescript
    this.statusBar.text = `${prefix}: ${page}${pageTag}`;
    ```
    <!-- bbb: explain -->
    ```
    Uses the prefix from step 14. Nav steps display "BBB →: description"; counted steps display "BBB N/total: description". Separating the prefix into its own variable keeps the template literal readable.
    ```

16. Compile to verify the changes are type-correct.
    <!-- bbb: terminal -->
    ```
    Set-Location 'C:\Users\tylwilli\Desktop\B3'; npm run compile
    ```
