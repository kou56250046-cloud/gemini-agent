---
id: vba-import
category: Excel・VBA
title: 表を取り込むマクロ（クリップボードの表 → 書式付きのシート）
usage: Excel で Alt+F11 →［挿入］→［標準モジュール］に全文を貼る（1 回だけ。個人用マクロブック PERSONAL.XLSB に入れると、どのブックでも使える）。Gem の応答の表（Markdown の表）か、gemini-agent の「表をコピー」でコピーしてから、［開発］→［マクロ］→「表を取り込む」を実行する
---
```vba
Option Explicit
' gemini-agent：クリップボードの表（Markdown の表・タブ区切り）を、新しいシートに書式付きで取り込む。
' 元のシートは変えない（いつも新しいシートを足す）。数字は数値、= で始まるものは数式、先頭が 0 の番号は文字のまま入れる。

Public Sub 表を取り込む()
    取り込む本体 True
End Sub

Public Sub 取り込む本体(ByVal 確認する As Boolean)
    Dim txt As String, lines() As String, s As String, v As String
    Dim rows As New Collection, cells() As String
    Dim ws As Worksheet, i As Long, j As Long, r As Long, nCol As Long
    On Error GoTo 後始末

    ' 1. クリップボードを読む
    txt = クリップボードの文字()
    If Len(Trim$(txt)) = 0 Then
        If 確認する Then MsgBox "クリップボードに表がありません。表をコピーしてから実行してください。", vbExclamation
        Exit Sub
    End If
    txt = Replace(Replace(txt, vbCrLf, vbLf), vbCr, vbLf)
    lines = Split(txt, vbLf)

    ' 2. 行と列に分ける（Markdown の表は | で、それ以外はタブで区切る）
    For i = LBound(lines) To UBound(lines)
        s = Trim$(lines(i))
        If Len(s) = 0 Or Left$(s, 3) = "```" Then GoTo 次の行
        If Left$(s, 1) = "|" Then
            ' 区切りの行（|---|:--:|）は飛ばす
            If Len(Replace(Replace(Replace(Replace(s, "|", ""), "-", ""), ":", ""), " ", "")) = 0 Then GoTo 次の行
            s = Mid$(s, 2)
            If Right$(s, 1) = "|" Then s = Left$(s, Len(s) - 1)
            cells = Split(s, "|")
        Else
            cells = Split(lines(i), vbTab)
        End If
        rows.Add cells
        If UBound(cells) + 1 > nCol Then nCol = UBound(cells) + 1
次の行:
    Next i
    If rows.Count = 0 Then
        If 確認する Then MsgBox "表として読める行がありません。", vbExclamation
        Exit Sub
    End If

    ' 3. 確かめてから、新しいシートに書く
    If 確認する Then
        If MsgBox(rows.Count & " 行 × " & nCol & " 列を、新しいシートに取り込みます。よいですか。", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    End If
    Application.ScreenUpdating = False
    Set ws = ActiveWorkbook.Worksheets.Add(After:=ActiveWorkbook.Worksheets(ActiveWorkbook.Worksheets.Count))
    ws.Name = "取込_" & Format$(Now, "mmdd_hhnnss")
    For r = 1 To rows.Count
        cells = rows(r)
        For j = 0 To UBound(cells)
            v = Trim$(Replace(cells(j), "**", ""))
            With ws.Cells(r, j + 1)
                If Left$(v, 1) = "=" And Len(v) > 1 And r > 1 Then
                    .Formula = v
                ElseIf r > 1 And 数値か(v) Then
                    .Value = CDbl(Replace(v, ",", ""))
                Else
                    .NumberFormat = "@"
                    .Value = v
                End If
            End With
        Next j
    Next r

    ' 4. 書式：見出しの色・罫線・フィルタ・見出しの固定・列幅
    With ws.Range(ws.Cells(1, 1), ws.Cells(1, nCol))
        .Font.Bold = True
        .Font.Color = RGB(255, 255, 255)
        .Interior.Color = RGB(31, 58, 95)
    End With
    With ws.Range(ws.Cells(1, 1), ws.Cells(rows.Count, nCol))
        .Borders.LineStyle = xlContinuous
        .Borders.Color = RGB(183, 194, 208)
        .VerticalAlignment = xlTop
        .AutoFilter
    End With
    ws.Columns.AutoFit
    For j = 1 To nCol
        If ws.Columns(j).ColumnWidth > 60 Then ws.Columns(j).ColumnWidth = 60: ws.Columns(j).WrapText = True
    Next j
    ws.Activate
    ActiveWindow.FreezePanes = False
    ws.Range("A2").Select
    ActiveWindow.FreezePanes = True
    Application.ScreenUpdating = True
    If 確認する Then MsgBox rows.Count - 1 & " 行（見出しを除く）を「" & ws.Name & "」に取り込みました。", vbInformation
    Exit Sub

後始末:
    Application.ScreenUpdating = True
    If 確認する Then MsgBox "取り込めませんでした：" & Err.Number & " " & Err.Description, vbExclamation Else Err.Raise Err.Number, , Err.Description
End Sub

' 桁区切り（1,200）・小数・マイナスを数値とみなす。先頭が 0 の番号（007）は文字のまま
Private Function 数値か(ByVal v As String) As Boolean
    Dim t As String
    t = Replace(v, ",", "")
    If Len(t) = 0 Then Exit Function
    If Not IsNumeric(t) Then Exit Function
    If Left$(t, 1) = "0" And Len(t) > 1 And Mid$(t, 2, 1) <> "." Then Exit Function
    If InStr(t, " ") > 0 Or LCase$(Right$(t, 1)) = "d" Or InStr(LCase$(t), "e") > 0 Then Exit Function
    数値か = True
End Function

' クリップボードの文字（日本語が化けないよう htmlfile を先に使い、だめなら DataObject）
Private Function クリップボードの文字() As String
    On Error Resume Next
    クリップボードの文字 = CreateObject("htmlfile").ParentWindow.ClipboardData.GetData("text")
    If Len(クリップボードの文字) = 0 Then
        With CreateObject("new:{1C3B4210-F441-11CE-B9EA-00AA006B1A69}")
            .GetFromClipboard
            クリップボードの文字 = .GetText(1)
        End With
    End If
    On Error GoTo 0
End Function
```
