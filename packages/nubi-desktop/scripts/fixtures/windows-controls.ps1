# Owned test window only. No company application or account access.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
$w=New-Object System.Windows.Window
$w.Title='Nubi UIA Verification'
$w.Width=500
$w.Height=650
$p=New-Object System.Windows.Controls.StackPanel
$t=New-Object System.Windows.Controls.TextBox
$t.Text='before'
[System.Windows.Automation.AutomationProperties]::SetName($t,'Nubi value')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($t,'NubiValue')
$p.Children.Add($t) | Out-Null
$secret=New-Object System.Windows.Controls.PasswordBox
[System.Windows.Automation.AutomationProperties]::SetName($secret,'Nubi password')
$p.Children.Add($secret) | Out-Null
$b=New-Object System.Windows.Controls.Button
$b.Content='Verify'
$b.Add_Click({$t.Text='clicked'})
$p.Children.Add($b) | Out-Null
$check=New-Object System.Windows.Controls.CheckBox
$check.Content='Nubi enabled'
[System.Windows.Automation.AutomationProperties]::SetAutomationId($check,'NubiEnabled')
$p.Children.Add($check) | Out-Null
$list=New-Object System.Windows.Controls.ListBox
$first=New-Object System.Windows.Controls.ListBoxItem
$first.Content='First option'
$second=New-Object System.Windows.Controls.ListBoxItem
$second.Content='Second option'
[System.Windows.Automation.AutomationProperties]::SetAutomationId($second,'NubiSecond')
$list.Items.Add($first) | Out-Null
$list.Items.Add($second) | Out-Null
$list.SelectedIndex=0
$p.Children.Add($list) | Out-Null
$tree=New-Object System.Windows.Controls.TreeView
$branch=New-Object System.Windows.Controls.TreeViewItem
$branch.Header='Nubi branch'
[System.Windows.Automation.AutomationProperties]::SetAutomationId($branch,'NubiBranch')
$leaf=New-Object System.Windows.Controls.TreeViewItem
$leaf.Header='Details'
$branch.Items.Add($leaf) | Out-Null
$tree.Items.Add($branch) | Out-Null
$p.Children.Add($tree) | Out-Null
$mouse=New-Object System.Windows.Controls.Button
$mouse.Content='Nubi mouse target'
$mouse.Height=50
[System.Windows.Automation.AutomationProperties]::SetAutomationId($mouse,'NubiMouse')
$mouse.Add_MouseMove({if ($t.Text -eq 'await-hover') {$t.Text='hovered'}})
$mouse.Add_Click({if ($script:doubleSeen) {$t.Text='double-clicked'} else {$t.Text='mouse-clicked'}})
$mouse.Add_MouseDoubleClick({$script:doubleSeen=$true;$t.Text='double-clicked'})
$mouse.Add_PreviewMouseRightButtonUp({$t.Text='right-clicked'})
$p.Children.Add($mouse) | Out-Null
$dragFrom=New-Object System.Windows.Controls.Button
$dragFrom.Content='Nubi drag source'
$dragFrom.Height=50
[System.Windows.Automation.AutomationProperties]::SetAutomationId($dragFrom,'NubiDragFrom')
$dragFrom.Add_PreviewMouseMove({param($sender,$event)
 if ($event.LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) {
  [System.Windows.DragDrop]::DoDragDrop($sender,'NubiDragFixture',[System.Windows.DragDropEffects]::Copy) | Out-Null
 }
})
$p.Children.Add($dragFrom) | Out-Null
$dragTo=New-Object System.Windows.Controls.Button
$dragTo.Content='Nubi drop target'
$dragTo.Height=50
$dragTo.AllowDrop=$true
[System.Windows.Automation.AutomationProperties]::SetAutomationId($dragTo,'NubiDragTo')
$dragTo.Add_DragOver({param($sender,$event)
 $event.Effects=[System.Windows.DragDropEffects]::Copy
 $event.Handled=$true
})
$dragTo.Add_Drop({param($sender,$event)
 if ($event.Data.GetData([string]) -eq 'NubiDragFixture') {$t.Text='dropped'}
 $event.Handled=$true
})
$p.Children.Add($dragTo) | Out-Null
$w.Content=$p
$w.Add_ContentRendered({[Console]::Out.WriteLine('NUBI_FIXTURE_READY');[Console]::Out.Flush()})
$w.ShowDialog() | Out-Null
