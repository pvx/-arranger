# Размещение отрезков в заготовках

Одностраничное приложение (React + TypeScript + Vite) для визуальной проверки случайного размещения
отрезков в заготовках длины R: случайный порядок (Fisher–Yates) + First Fit.

## Запуск

Нужен Node.js 18+.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # тесты алгоритма (vitest)
npm run build    # production-сборка в dist/
```

## Структура

- `src/packing.ts` — разбор чисел (в тысячных долях), валидация, развёртка экземпляров, перемешивание, First Fit, статистика. Без React.
- `src/packing.test.ts` — тесты алгоритма.
- `src/App.tsx` — интерфейс, история запусков, сохранение ввода в localStorage.
- `src/styles.css` — стили.
