Опасный документ
================

<script>alert('xss')</script>
<style>body{display:none}</style>
<iframe src="https://evil.example"></iframe>
<object data="evil.swf"></object>
<form action="/steal"><input type="password" name="p"></form>
<svg onload="alert(1)"><script>alert(2)</script></svg>

<img src=x onerror="alert(1)">
<a href="javascript:alert(1)">js</a>
<a href="JaVaScRiPt:alert(1)">js mixed case</a>
<a href="data:text/html;base64,PHNjcmlwdD4=">data url</a>
<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==">
<div onclick="alert(1)" style="position:fixed;top:0">клик</div>

[ссылка](javascript:alert(1))

<!-- внутренняя заметка -->
