Опасные расширения GFM
======================

Инлайн-математика пробует выйти наружу: $</span><script>alert(1)</script><span>$

Блочная математика:

$$
</div><script>alert(2)</script><div>
$$

Фенс математики:

```math
</div><img src=x onerror="alert(3)">
```

Mermaid со скриптом:

```mermaid
graph TD; A[<script>alert(4)</script>] --> B["</pre><iframe src=//evil.example>"];
```

Маркер alert-а с попыткой подмешать класс:

> [!NOTE" onclick="alert(5)]
> тело

> [!NOTE zzz]
> тело

Подделка alert-а руками:

<div class="alert alert-note" onclick="alert(6)">
<p class="alert-title" style="position:fixed">Note</p>
</div>

## fn-1

## fnref-1

Сноска[^1].

[^1]: текст сноски
