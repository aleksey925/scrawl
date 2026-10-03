# Alerts

> [!NOTE]
> Useful information that users should know, even when skimming.

> [!TIP]
> Helpful advice for doing things better.

> [!IMPORTANT]
> Key information users need to know.

> [!WARNING]
> Urgent info that needs immediate attention.

> [!CAUTION]
> Advises about risks or negative outcomes.

## Что alert-ом не становится

Текст на строке маркера убивает alert целиком:

> [!NOTE] с текстом на той же строке
> тело

Маркер не на первой строке:

> сначала текст
> [!NOTE]

Неизвестный маркер:

> [!FOO]
> неизвестный маркер

Маркер без тела:

> [!WARNING]

Вложенная цитата не alert, GitHub их не вкладывает:

> > [!NOTE]
> > вложенный

Цитата внутри элемента списка тоже:

- > [!IMPORTANT]
  > внутри списка

## Что alert-ом становится

Маркер в нижнем регистре и без пробела после `>`:

>[!tip]
> нижний регистр

Пробелы в конце строки маркера:

> [!NOTE]  
> хвостовые пробелы

Ленивое продолжение:

> [!CAUTION]
> первая строка
вторая строка

Несколько блоков в теле, включая настоящую цитату:

> [!NOTE]
>
> Первый абзац с `кодом` и [ссылкой](other.md).
>
> - список
> - внутри
>
> > обычная вложенная цитата
