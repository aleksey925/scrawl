- ротация и отзыв ключей делаются руками.

1. Установка

```bash
brew install sops age
```

`age` нужен только для генерации ключа, `sops` - для шифрования
и редактирования. Расшифровывает mise сам, встроенным rops.

2. Генерация ключа

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
```

В файле окажется приватный ключ (`AGE-SECRET-KEY-1...`) и публичный
комментарием (`# public key: age1...`).
